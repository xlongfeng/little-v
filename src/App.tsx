import { invoke } from "@tauri-apps/api/core";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { computeNetProfit, pricePrecision, toTableRows, type StockLedger, type StockOption, type TableRow } from "./ledger";
import { searchStocks } from "./stockApi";
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

  return (
    <main className="app-shell">
      <header className="menu-bar">
        <div className="brand">Little V</div>
        <nav aria-label="Application menu">
          <button type="button" onClick={() => setDialogOpen(true)}>Create</button>
          <button type="button" onClick={() => setSettingsOpen(true)}>Settings</button>
          <button type="button" onClick={() => setAboutOpen(true)}>About</button>
        </nav>
        <span className="total-profit">Total profit: {formatTotalProfit(rows)}</span>
      </header>

      <section className="filter-bar" aria-label="Record controls">
        <span className="filter-label">Filters</span>
        <div className="name-filter" ref={nameFilterRef}>
          <button
            type="button"
            aria-label="Names"
            aria-expanded={nameFilterOpen}
            onClick={() => setNameFilterOpen((open) => !open)}
          >
            {filterNames.length === selectedFilterCount ? "All" : `${selectedFilterCount} selected`}
          </button>
          {nameFilterOpen && (
            <div className="name-filter-menu" role="group" aria-label="Filter by names">
              <label className="select-all-filter">
                <input
                  type="checkbox"
                  checked={filterNames.length > 0 && selectedFilterCount === filterNames.length}
                  onChange={(event) => toggleAllFilterNames(event.target.checked)}
                />
                All
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
              {!filterNames.length && <p>No names available</p>}
            </div>
          )}
        </div>
        <label className="inline-filter">
          Status
          <select aria-label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="all">All</option>
            <option value="open">Open only</option>
            <option value="closed">Closed only</option>
          </select>
        </label>
        <label className="inline-filter">
          Period
          <select aria-label="Period" value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value as PeriodFilter)}>
            <option value="all">All</option>
            <option value="6m">Last 6 months</option>
            <option value="1y">Last year</option>
            <option value="2y">Last 2 years</option>
          </select>
        </label>
        <span>{rows.length} record{rows.length === 1 ? "" : "s"}</span>
      </section>

      {loadError && <p className="error-banner" role="alert">Could not load records: {loadError}</p>}

      <section className="table-wrapper" aria-label="Trading records">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Quantity</th>
              <th>Buy Price</th>
              <th>Buy Date</th>
              <th>Sell Price</th>
              <th>Sell Date</th>
              <th>Profit</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={isRowClosed(row) ? "closed-row" : undefined} onDoubleClick={() => setEditingRow(row)}>
                <td>
                  {row.name}
                  {row.note && (
                    <span className="comment-indicator" title={row.note} aria-label={`Note: ${row.note}`}>
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
                    aria-label="Delete transaction"
                    title="Delete transaction"
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
                <td colSpan={8} className="empty-state">No trading records yet. Use Create to add one.</td>
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
          <section className="dialog" role="dialog" aria-label="Delete transaction">
            <div className="dialog-heading">
              <h2>Delete transaction</h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  setPendingDelete(null);
                  setDeleteError("");
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p>Are you sure you want to delete this transaction for <strong>{pendingDelete.name}</strong>? This cannot be undone.</p>
            {deleteError && <p className="field-error" role="alert">Could not delete transaction: {deleteError}</p>}
            <div className="dialog-actions">
              <button
                type="button"
                onClick={() => {
                  setPendingDelete(null);
                  setDeleteError("");
                }}
              >
                Cancel
              </button>
              <button type="button" className="primary danger" onClick={() => void confirmDeleteTransaction()} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </section>
        </div>
      )}
      {aboutOpen && <InfoDialog title="About Little V" onClose={() => setAboutOpen(false)}>A local stock transaction ledger.</InfoDialog>}
      {settingsOpen && <InfoDialog title="Settings" onClose={() => setSettingsOpen(false)}>Settings will be available in a future release.</InfoDialog>}
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
      setSearchError(`Stock search is unavailable: ${String(lookupError)}`);
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
      setError("Select a stock.");
      return;
    }
    const hasQuantity = form.quantity.trim() !== "";
    const quantity = hasQuantity ? Number(form.quantity) : null;
    if (hasQuantity && quantity !== null) {
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError("Quantity must be greater than zero.");
        return;
      }
      if (!Number.isInteger(quantity)) {
        setError("Quantity must be a whole number.");
        return;
      }
      if (quantity % 100 !== 0) {
        setError("Quantity must be a multiple of 100.");
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
      <form className="dialog" onSubmit={submit} aria-label={editing ? "Edit transaction" : "Create transaction"} noValidate>
        <div className="dialog-heading"><h2>{editing ? "Edit transaction" : "Create transaction"}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button></div>
        <label>Stock
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
              placeholder="Select or search a stock"
              role="combobox"
              aria-label="Stock"
              aria-expanded={stockListOpen}
              aria-controls="stock-options"
              aria-autocomplete="list"
            />
            {!editing && (
              <button
                type="button"
                className="combobox-toggle"
                aria-label="Show existing stocks"
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
                {!choices.length && <li className="no-options">No matching stocks found.</li>}
              </ul>
            )}
          </div>
        </label>
        {searchError && <p className="field-error" role="alert">{searchError}</p>}
        <label>Quantity<input type="number" min="0" step="100" inputMode="numeric" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value.split(".")[0] })} /></label>
        <div className="two-columns">
          <label>Buy price<input type="number" min="0.01" step={priceStep} value={form.buyPrice} onChange={(event) => setForm({ ...form, buyPrice: event.target.value })} /></label>
          <label>Buy date<input type="date" className={form.buyDate ? undefined : "date-empty"} value={form.buyDate} onChange={(event) => setForm({ ...form, buyDate: event.target.value })} /></label>
        </div>
        <div className="two-columns">
          <label>Sell price<input type="number" min="0.01" step={priceStep} value={form.sellPrice} onChange={(event) => setForm({ ...form, sellPrice: event.target.value })} /></label>
          <label>Sell date<input type="date" className={form.sellDate ? undefined : "date-empty"} value={form.sellDate} onChange={(event) => setForm({ ...form, sellDate: event.target.value })} /></label>
        </div>
        <label>Note<textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button></div>
      </form>
    </div>
  );
}

function InfoDialog({ title, children, onClose }: { title: string; children: string; onClose: () => void }) {
  return <div className="dialog-backdrop" role="presentation"><section className="dialog info-dialog" role="dialog" aria-label={title}><div className="dialog-heading"><h2>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button></div><p>{children}</p></section></div>;
}

export default App;
