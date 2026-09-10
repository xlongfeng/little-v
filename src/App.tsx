import { invoke } from "@tauri-apps/api/core";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { computeNetProfit, pricePrecision, toTableRows, type StockLedger, type StockOption, type TableRow } from "./ledger";
import { searchStocks } from "./stockApi";
import { version as appVersion } from "../package.json";
import { formatRecordCount, isLanguagePreference, useLanguage, type LanguagePreference } from "./i18n";
import { LanguageProvider } from "./LanguageProvider";
import "./App.css";

type StatusFilter = "all" | "open" | "closed";
type PeriodFilter = "all" | "6m" | "1y" | "2y";

const PERIOD_MONTHS: Record<Exclude<PeriodFilter, "all">, number> = {
  "6m": 6,
  "1y": 12,
  "2y": 24,
};

function periodCutoff(period: PeriodFilter): string | null {
  if (period === "all") {
    return null;
  }
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - PERIOD_MONTHS[period]);
  return cutoff.toISOString().slice(0, 10);
}

function mostRecentDate(row: { buyDate?: string; sellDate?: string }): string | undefined {
  if (row.buyDate && row.sellDate) {
    return row.buyDate > row.sellDate ? row.buyDate : row.sellDate;
  }
  return row.buyDate ?? row.sellDate;
}

function isRowClosed(row: { quantity?: number | null; buyPrice?: number | null; buyDate?: string | null; sellPrice?: number | null; sellDate?: string | null }): boolean {
  return (
    row.quantity != null &&
    row.buyPrice != null &&
    row.buyDate != null &&
    row.sellPrice != null &&
    row.sellDate != null
  );
}

function netProfitFor(row: TableRow): number | null {
  if (row.quantity == null || row.buyPrice == null || row.sellPrice == null) {
    return null;
  }
  return computeNetProfit(row.code, row.quantity, row.buyPrice, row.sellPrice);
}

function formatNetProfit(row: TableRow): string {
  const profit = netProfitFor(row);
  return profit == null ? "" : profit.toFixed(2);
}

function formatTotalProfit(rows: TableRow[]): string {
  const total = rows.reduce((sum, row) => sum + (netProfitFor(row) ?? 0), 0);
  return total.toFixed(2);
}

const UP_STEPS = Array.from({ length: 10 }, (_, index) => index + 1);
const DOWN_STEPS = Array.from({ length: 10 }, (_, index) => -(index + 1));
const HOVER_POPUP_DELAY_MS = 500;

function PriceCell({ price, code }: { price: number | null | undefined; code: string }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  function clearTimer() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function handleMouseEnter() {
    clearTimer();
    timerRef.current = window.setTimeout(() => setVisible(true), HOVER_POPUP_DELAY_MS);
  }

  function handleMouseLeave() {
    clearTimer();
    setVisible(false);
  }

  useEffect(() => clearTimer, []);

  if (price == null) {
    return <td></td>;
  }
  const precision = pricePrecision(code);
  return (
    <td className="price-cell" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {price.toFixed(precision)}
      {visible && (
        <div className="price-popup" role="tooltip">
          <table>
            <thead>
              <tr>
                {UP_STEPS.map((pct) => (
                  <th key={pct}>+{pct}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {UP_STEPS.map((pct) => (
                  <td key={pct}>{(price * (1 + pct / 100)).toFixed(precision)}</td>
                ))}
              </tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                {DOWN_STEPS.map((pct) => (
                  <th key={pct}>{pct}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {DOWN_STEPS.map((pct) => (
                  <td key={pct}>{(price * (1 + pct / 100)).toFixed(precision)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </td>
  );
}

interface TransactionForm {
  stock: StockOption | null;
  quantity: string;
  buyPrice: string;
  buyDate: string;
  sellPrice: string;
  sellDate: string;
  note: string;
}

const initialForm = (): TransactionForm => ({
  stock: null,
  quantity: "1000",
  buyPrice: "",
  buyDate: "",
  sellPrice: "",
  sellDate: "",
  note: "",
});

function formFromRow(row: TableRow): TransactionForm {
  return {
    stock: { code: row.code, name: row.name },
    quantity: row.quantity != null ? String(row.quantity) : "",
    buyPrice: row.buyPrice != null ? String(row.buyPrice) : "",
    buyDate: row.buyDate ?? "",
    sellPrice: row.sellPrice != null ? String(row.sellPrice) : "",
    sellDate: row.sellDate ?? "",
    note: row.note ?? "",
  };
}

function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}

function AppContent() {
  const { language, languagePreference, setLanguagePreference, t } = useLanguage();
  const [ledgers, setLedgers] = useState<StockLedger[]>([]);
  const [excludedFilterNames, setExcludedFilterNames] = useState<string[]>([]);
  const [nameFilterOpen, setNameFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<TableRow | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ code: string; uuid: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const nameFilterRef = useRef<HTMLDivElement>(null);

  const loadLedgers = async () => {
    try {
      setLedgers(await invoke<StockLedger[]>("load_stock_ledgers"));
      setLoadError("");
    } catch (error) {
      setLoadError(String(error));
    }
  };

  useEffect(() => {
    void loadLedgers();
  }, []);

  async function confirmDeleteTransaction() {
    if (!pendingDelete) {
      return;
    }
    setDeleting(true);
    try {
      await invoke("delete_transaction", { code: pendingDelete.code, uuid: pendingDelete.uuid });
      setDeleteError("");
      setPendingDelete(null);
      void loadLedgers();
    } catch (error) {
      setDeleteError(String(error));
    } finally {
      setDeleting(false);
    }
  }

  const allRows = useMemo(() => toTableRows(ledgers), [ledgers]);
  const filterNames = useMemo(
    () => [...new Set(allRows.map((row) => row.name))].sort((left, right) => left.localeCompare(right)),
    [allRows],
  );
  const rows = useMemo(() => {
    const cutoff = periodCutoff(periodFilter);
    return allRows.filter((row) => {
      if (excludedFilterNames.includes(row.name)) {
        return false;
      }
      const isClosed = isRowClosed(row);
      if (statusFilter === "open" && isClosed) {
        return false;
      }
      if (statusFilter === "closed" && !isClosed) {
        return false;
      }
      if (cutoff) {
        const recentDate = mostRecentDate(row);
        if (recentDate && recentDate < cutoff) {
          return false;
        }
      }
      return true;
    });
  }, [allRows, excludedFilterNames, statusFilter, periodFilter]);
  const selectedFilterCount = filterNames.length - excludedFilterNames.length;

  useEffect(() => {
    setExcludedFilterNames((names) => names.filter((name) => filterNames.includes(name)));
  }, [filterNames]);

  useEffect(() => {
    if (!nameFilterOpen) {
      return;
    }

    const closeWhenClickedOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !nameFilterRef.current?.contains(event.target)) {
        setNameFilterOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeWhenClickedOutside);
    return () => document.removeEventListener("pointerdown", closeWhenClickedOutside);
  }, [nameFilterOpen]);

  function toggleFilterName(name: string, checked: boolean) {
    setExcludedFilterNames((names) =>
      checked ? names.filter((currentName) => currentName !== name) : [...names, name],
    );
  }

  function toggleAllFilterNames(checked: boolean) {
    setExcludedFilterNames(checked ? [] : filterNames);
  }

  const [deleteConfirmBefore, deleteConfirmAfter] = t("deleteDialog.confirm").split("{name}");

  return (
    <main className="app-shell">
      <header className="menu-bar">
        <div className="brand">Little V</div>
        <nav aria-label={t("table.applicationMenu")}>
          <button type="button" onClick={() => setDialogOpen(true)}>{t("menu.create")}</button>
          <button type="button" onClick={() => setSettingsOpen(true)}>{t("menu.settings")}</button>
          <button type="button" onClick={() => setAboutOpen(true)}>{t("menu.about")}</button>
        </nav>
        <span className="total-profit">{t("totalProfit", { value: formatTotalProfit(rows) })}</span>
      </header>

      <section className="filter-bar" aria-label={t("table.recordControls")}>
        <span className="filter-label">{t("filters.label")}</span>
        <div className="name-filter" ref={nameFilterRef}>
          <button
            type="button"
            aria-label={t("filters.names")}
            aria-expanded={nameFilterOpen}
            onClick={() => setNameFilterOpen((open) => !open)}
          >
            {filterNames.length === selectedFilterCount ? t("filters.all") : t("filters.selected", { count: selectedFilterCount })}
          </button>
          {nameFilterOpen && (
            <div className="name-filter-menu" role="group" aria-label={t("filters.filterByNames")}>
              <label className="select-all-filter">
                <input
                  type="checkbox"
                  checked={filterNames.length > 0 && selectedFilterCount === filterNames.length}
                  onChange={(event) => toggleAllFilterNames(event.target.checked)}
                />
                {t("filters.all")}
              </label>
              {filterNames.map((name) => (
                <label key={name}>
                  <input
                    type="checkbox"
                    checked={!excludedFilterNames.includes(name)}
                    onChange={(event) => toggleFilterName(name, event.target.checked)}
                  />
                  {name}
                </label>
              ))}
              {!filterNames.length && <p>{t("filters.noNames")}</p>}
            </div>
          )}
        </div>
        <label className="inline-filter">
          {t("filters.status")}
          <select aria-label={t("filters.status")} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="all">{t("filters.all")}</option>
            <option value="open">{t("filters.statusOpen")}</option>
            <option value="closed">{t("filters.statusClosed")}</option>
          </select>
        </label>
        <label className="inline-filter">
          {t("filters.period")}
          <select aria-label={t("filters.period")} value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value as PeriodFilter)}>
            <option value="all">{t("filters.all")}</option>
            <option value="6m">{t("filters.period6m")}</option>
            <option value="1y">{t("filters.period1y")}</option>
            <option value="2y">{t("filters.period2y")}</option>
          </select>
        </label>
        <span>{formatRecordCount(language, rows.length)}</span>
      </section>

      {loadError && <p className="error-banner" role="alert">{t("loadError", { error: loadError })}</p>}

      <section className="table-wrapper" aria-label={t("table.tradingRecords")}>
        <table>
          <colgroup>
            <col className="col-name" />
            <col className="col-quantity" />
            <col className="col-buy-price" />
            <col className="col-buy-date" />
            <col className="col-sell-price" />
            <col className="col-sell-date" />
            <col className="col-profit" />
            <col className="col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>{t("table.name")}</th>
              <th>{t("table.quantity")}</th>
              <th>{t("table.buyPrice")}</th>
              <th>{t("table.buyDate")}</th>
              <th>{t("table.sellPrice")}</th>
              <th>{t("table.sellDate")}</th>
              <th>{t("table.profit")}</th>
              <th>{t("table.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={isRowClosed(row) ? "closed-row" : undefined} onDoubleClick={() => setEditingRow(row)}>
                <td>
                  {row.name}
                  {row.note && (
                    <span className="comment-indicator" title={row.note} aria-label={t("table.note", { note: row.note })}>
                      💬
                    </span>
                  )}
                </td>
                <td>{row.quantity ?? ""}</td>
                <PriceCell price={row.buyPrice} code={row.code} />
                <td>{row.buyDate ?? ""}</td>
                <PriceCell price={row.sellPrice} code={row.code} />
                <td>{row.sellDate ?? ""}</td>
                <td>{formatNetProfit(row)}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="icon-button delete-row"
                    aria-label={t("table.deleteTransaction")}
                    title={t("table.deleteTransaction")}
                    onClick={() => {
                      setDeleteError("");
                      setPendingDelete({ code: row.code, uuid: row.key, name: row.name });
                    }}
                  >
                    🗑
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="empty-state">{t("table.noRecords")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {dialogOpen && (
        <TransactionDialog
          ledgers={ledgers}
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            setDialogOpen(false);
            void loadLedgers();
          }}
        />
      )}
      {editingRow && (
        <TransactionDialog
          ledgers={ledgers}
          editing={editingRow}
          onClose={() => setEditingRow(null)}
          onCreated={() => {
            setEditingRow(null);
            void loadLedgers();
          }}
        />
      )}
      {pendingDelete && (
        <div className="dialog-backdrop" role="presentation">
          <section className="dialog" role="dialog" aria-label={t("deleteDialog.title")}>
            <div className="dialog-heading">
              <h2>{t("deleteDialog.title")}</h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  setPendingDelete(null);
                  setDeleteError("");
                }}
                aria-label={t("dialog.close")}
              >
                ×
              </button>
            </div>
            <p>{deleteConfirmBefore}<strong>{pendingDelete.name}</strong>{deleteConfirmAfter}</p>
            {deleteError && <p className="field-error" role="alert">{t("deleteDialog.error", { error: deleteError })}</p>}
            <div className="dialog-actions">
              <button
                type="button"
                onClick={() => {
                  setPendingDelete(null);
                  setDeleteError("");
                }}
              >
                {t("deleteDialog.cancel")}
              </button>
              <button type="button" className="primary danger" onClick={() => void confirmDeleteTransaction()} disabled={deleting}>
                {deleting ? t("deleteDialog.deleting") : t("deleteDialog.delete")}
              </button>
            </div>
          </section>
        </div>
      )}
      {aboutOpen && (
        <InfoDialog
          title={<>{t("about.title")} <span className="version-tag">{t("about.version", { version: appVersion })}</span></>}
          ariaLabel={`${t("about.title")} ${t("about.version", { version: appVersion })}`}
          onClose={() => setAboutOpen(false)}
        >
          <p>{t("about.description")}</p>
        </InfoDialog>
      )}
      {settingsOpen && (
        <InfoDialog title={t("settings.title")} onClose={() => setSettingsOpen(false)}>
          <fieldset className="settings-group">
            <legend>{t("settings.general")}</legend>
            <div className="settings-grid">
              <label htmlFor="settings-language">{t("settings.language")}</label>
              <select
                id="settings-language"
                aria-label={t("settings.language")}
                value={languagePreference}
                onChange={(event) => {
                  if (isLanguagePreference(event.target.value)) {
                    setLanguagePreference(event.target.value as LanguagePreference);
                  }
                }}
              >
                <option value="system">{t("settings.languageDefault")}</option>
                <option value="en">{t("settings.languageEnglish")}</option>
                <option value="zh_cn">{t("settings.languageZhCn")}</option>
              </select>
            </div>
          </fieldset>
        </InfoDialog>
      )}
    </main>
  );
}

function TransactionDialog({
  ledgers,
  editing,
  onClose,
  onCreated,
}: {
  ledgers: StockLedger[];
  editing?: TableRow;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState(() => (editing ? formFromRow(editing) : initialForm()));
  const [stockQuery, setStockQuery] = useState(() => (editing ? `${editing.name} (${editing.code})` : ""));
  const [searchResults, setSearchResults] = useState<StockOption[] | null>(null);
  const [stockListOpen, setStockListOpen] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const stockComboboxRef = useRef<HTMLDivElement>(null);
  const localStocks = useMemo(
    () => ledgers.map(({ code, name }) => ({ code, name })),
    [ledgers],
  );
  const priceStep = 1 / 10 ** pricePrecision(form.stock?.code ?? "");
  const choices = searchResults ?? localStocks;

  useEffect(() => {
    if (!stockListOpen) {
      return;
    }

    const closeWhenClickedOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !stockComboboxRef.current?.contains(event.target)) {
        setStockListOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeWhenClickedOutside);
    return () => document.removeEventListener("pointerdown", closeWhenClickedOutside);
  }, [stockListOpen]);

  async function lookup() {
    const query = stockQuery.trim();
    if (!query) {
      setSearchResults(null);
      setSearchError("");
      setStockListOpen(true);
      return;
    }

    try {
      setSearchResults(await searchStocks(query));
      setSearchError("");
      setStockListOpen(true);
    } catch (lookupError) {
      setSearchResults([]);
      setSearchError(t("dialog.stockSearchUnavailable", { error: String(lookupError) }));
      setStockListOpen(true);
    }
  }

  function selectStock(stock: StockOption) {
    setForm({ ...form, stock });
    setStockQuery(`${stock.name} (${stock.code})`);
    setStockListOpen(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.stock) {
      setError(t("dialog.selectStock"));
      return;
    }
    const hasQuantity = form.quantity.trim() !== "";
    const quantity = hasQuantity ? Number(form.quantity) : null;
    if (hasQuantity && quantity !== null) {
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError(t("dialog.quantityPositive"));
        return;
      }
      if (!Number.isInteger(quantity)) {
        setError(t("dialog.quantityWholeNumber"));
        return;
      }
      if (quantity % 100 !== 0) {
        setError(t("dialog.quantityMultiple100"));
        return;
      }
    }
    const hasBuyPrice = form.buyPrice.trim() !== "";
    const hasBuyDate = form.buyDate.trim() !== "";
    const hasSellPrice = form.sellPrice.trim() !== "";
    const hasSellDate = form.sellDate.trim() !== "";
    const hasNote = form.note.trim() !== "";
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await invoke("update_transaction", {
          request: {
            code: editing.code,
            uuid: editing.key,
            quantity,
            buyPrice: hasBuyPrice ? Number(form.buyPrice) : null,
            buyDate: hasBuyDate ? form.buyDate : null,
            sellPrice: hasSellPrice ? Number(form.sellPrice) : null,
            sellDate: hasSellDate ? form.sellDate : null,
            note: hasNote ? form.note : null,
          },
        });
      } else {
        await invoke("create_transaction", {
          request: {
            name: form.stock.name,
            code: form.stock.code,
            quantity,
            buyPrice: hasBuyPrice ? Number(form.buyPrice) : null,
            buyDate: hasBuyDate ? form.buyDate : null,
            sellPrice: hasSellPrice ? Number(form.sellPrice) : null,
            sellDate: hasSellDate ? form.sellDate : null,
            note: hasNote ? form.note : null,
          },
        });
      }
      onCreated();
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="dialog" onSubmit={submit} aria-label={editing ? t("dialog.editTransaction") : t("dialog.createTransaction")} noValidate>
        <div className="dialog-heading"><h2>{editing ? t("dialog.editTransaction") : t("dialog.createTransaction")}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={t("dialog.close")}>×</button></div>
        <label>{t("dialog.stock")}
          <div className="stock-combobox" ref={stockComboboxRef}>
            <input
              value={stockQuery}
              disabled={!!editing}
              onChange={(event) => {
                setStockQuery(event.target.value);
                setForm({ ...form, stock: null });
              }}
              onFocus={() => !editing && setStockListOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void lookup();
                }
              }}
              placeholder={t("dialog.stockPlaceholder")}
              role="combobox"
              aria-label={t("dialog.stock")}
              aria-expanded={stockListOpen}
              aria-controls="stock-options"
              aria-autocomplete="list"
            />
            {!editing && (
              <button
                type="button"
                className="combobox-toggle"
                aria-label={t("dialog.showExistingStocks")}
                onClick={() => {
                  setSearchResults(null);
                  setSearchError("");
                  setStockListOpen(true);
                }}
              >
                ▾
              </button>
            )}
            {!editing && stockListOpen && (
              <ul id="stock-options" className="stock-options" role="listbox">
                {choices.map((stock) => (
                  <li key={stock.code} role="option" aria-selected={form.stock?.code === stock.code}>
                    <button type="button" onClick={() => selectStock(stock)}>
                      {stock.name} <span>({stock.code})</span>
                    </button>
                  </li>
                ))}
                {!choices.length && <li className="no-options">{t("dialog.noMatchingStocks")}</li>}
              </ul>
            )}
          </div>
        </label>
        {searchError && <p className="field-error" role="alert">{searchError}</p>}
        <label>{t("dialog.quantity")}<input type="number" min="0" step="100" inputMode="numeric" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value.split(".")[0] })} /></label>
        <div className="two-columns">
          <label>{t("dialog.buyPrice")}<input type="number" min="0.01" step={priceStep} value={form.buyPrice} onChange={(event) => setForm({ ...form, buyPrice: event.target.value })} /></label>
          <label>{t("dialog.buyDate")}<input type="date" className={form.buyDate ? undefined : "date-empty"} value={form.buyDate} onChange={(event) => setForm({ ...form, buyDate: event.target.value })} /></label>
        </div>
        <div className="two-columns">
          <label>{t("dialog.sellPrice")}<input type="number" min="0.01" step={priceStep} value={form.sellPrice} onChange={(event) => setForm({ ...form, sellPrice: event.target.value })} /></label>
          <label>{t("dialog.sellDate")}<input type="date" className={form.sellDate ? undefined : "date-empty"} value={form.sellDate} onChange={(event) => setForm({ ...form, sellDate: event.target.value })} /></label>
        </div>
        <label>{t("dialog.note")}<textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button type="button" onClick={onClose}>{t("dialog.cancel")}</button><button className="primary" type="submit" disabled={saving}>{saving ? t("dialog.saving") : t("dialog.save")}</button></div>
      </form>
    </div>
  );
}

function InfoDialog({
  title,
  ariaLabel,
  children,
  onClose,
}: {
  title: ReactNode;
  ariaLabel?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return <div className="dialog-backdrop" role="presentation"><section className="dialog info-dialog" role="dialog" aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}><div className="dialog-heading"><h2>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button></div>{children}</section></div>;
}

export default App;
