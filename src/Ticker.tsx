import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { displayStockCode, displayStockName, pricePrecision, type StockLedger, type StockOption } from "./ledger";
import { LanguageProvider } from "./LanguageProvider";
import { PriceFeedProvider, usePriceFeed } from "./PriceFeedProvider";
import { searchAnyStocks } from "./stockApi";
import { useLanguage } from "./i18n";
import "./Ticker.css";

interface TickerStock extends StockOption {
  lower: string;
  upper: string;
}

interface TickerPosition {
  x: number;
  y: number;
}

const TICKER_STOCKS_CHANGED_EVENT = "ticker-stocks-changed";
const TICKER_POSITION_CHANGED_EVENT = "ticker-position-changed";
const TICKER_VISIBILITY_CHANGED_EVENT = "ticker-visibility-changed";
const TICKER_VISIBLE_STORAGE_KEY = "littlev-ticker-visible";
const TICKER_POSITION_STORAGE_KEY = "littlev-ticker-position";
export const TICKER_OPACITY_CHANGED_EVENT = "ticker-opacity-changed";
export const TICKER_OPACITY_STORAGE_KEY = "littlev-ticker-opacity";
export const DEFAULT_TICKER_OPACITY = 100;
export const TICKER_FONT_COLOR_CHANGED_EVENT = "ticker-font-color-changed";
export const TICKER_FONT_COLOR_STORAGE_KEY = "littlev-ticker-font-color";
export const DEFAULT_TICKER_FONT_COLOR = "#212121";
export const TICKER_FONT_SIZE_CHANGED_EVENT = "ticker-font-size-changed";
export const TICKER_FONT_SIZE_STORAGE_KEY = "littlev-ticker-font-size";
export const DEFAULT_TICKER_FONT_SIZE = 14;
export const MIN_TICKER_FONT_SIZE = 10;
export const MAX_TICKER_FONT_SIZE = 16;
const DOUBLE_CLICK_INTERVAL_MS = 500;
const DOUBLE_CLICK_DISTANCE_PX = 5;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function formatPercent(percent: number): string {
  return `${percent > 0 ? "+" : ""}${(percent * 100).toFixed(2)}%`;
}

function validLimit(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function alarmActive(stock: TickerStock, price: number | undefined): boolean {
  if (price == null) {
    return false;
  }
  const lower = validLimit(stock.lower);
  const upper = validLimit(stock.upper);
  return (lower != null && price < lower) || (upper != null && price > upper);
}

export function readStoredTickerOpacity(): number {
  const stored = Number(window.localStorage.getItem(TICKER_OPACITY_STORAGE_KEY));
  return Number.isFinite(stored) && stored >= 10 && stored <= 100 ? stored : DEFAULT_TICKER_OPACITY;
}

export function isTickerFontColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

export function readStoredTickerFontColor(): string {
  const stored = window.localStorage.getItem(TICKER_FONT_COLOR_STORAGE_KEY);
  return stored != null && isTickerFontColor(stored) ? stored : DEFAULT_TICKER_FONT_COLOR;
}

export function isTickerFontSize(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_TICKER_FONT_SIZE && value <= MAX_TICKER_FONT_SIZE;
}

export function readStoredTickerFontSize(): number {
  const stored = Number(window.localStorage.getItem(TICKER_FONT_SIZE_STORAGE_KEY));
  return isTickerFontSize(stored) ? stored : DEFAULT_TICKER_FONT_SIZE;
}

function TickerOverlayContent() {
  const { t } = useLanguage();
  const { quotes, setCodes } = usePriceFeed();
  const [stocks, setStocks] = useState<TickerStock[]>([]);
  const [opacity, setOpacity] = useState(DEFAULT_TICKER_OPACITY);
  const [fontColor, setFontColor] = useState(DEFAULT_TICKER_FONT_COLOR);
  const [fontSize, setFontSize] = useState(DEFAULT_TICKER_FONT_SIZE);
  const overlayRef = useRef<HTMLElement>(null);
  const lastPointerDownRef = useRef<{ time: number; x: number; y: number } | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("ticker-page");
    document.body.classList.add("ticker-page");
    return () => {
      document.documentElement.classList.remove("ticker-page");
      document.body.classList.remove("ticker-page");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadStocks() {
      const loaded = await invoke<TickerStock[]>("load_ticker_stocks");
      if (!cancelled) {
        setStocks(loaded);
      }
    }
    void loadStocks();

    const storedPosition = window.localStorage.getItem(TICKER_POSITION_STORAGE_KEY);
    if (storedPosition) {
      try {
        const position = JSON.parse(storedPosition) as TickerPosition;
        if (Number.isInteger(position.x) && Number.isInteger(position.y)) {
          void invoke("set_ticker_position", { x: position.x, y: position.y });
        }
      } catch {
        window.localStorage.removeItem(TICKER_POSITION_STORAGE_KEY);
      }
    }
    const visible = window.localStorage.getItem(TICKER_VISIBLE_STORAGE_KEY) === "true";
    void invoke("set_ticker_visibility", { visible });
    setOpacity(readStoredTickerOpacity());
    setFontColor(readStoredTickerFontColor());
    setFontSize(readStoredTickerFontSize());

    let stopStocks: (() => void) | undefined;
    let stopPosition: (() => void) | undefined;
    let stopVisibility: (() => void) | undefined;
    let stopOpacity: (() => void) | undefined;
    let stopFontColor: (() => void) | undefined;
    let stopFontSize: (() => void) | undefined;
    void listen(TICKER_STOCKS_CHANGED_EVENT, () => void loadStocks()).then((stop) => {
      stopStocks = stop;
    });
    void listen<TickerPosition>(TICKER_POSITION_CHANGED_EVENT, (event) => {
      window.localStorage.setItem(TICKER_POSITION_STORAGE_KEY, JSON.stringify(event.payload));
    }).then((stop) => {
      stopPosition = stop;
    });
    void listen<boolean>(TICKER_VISIBILITY_CHANGED_EVENT, (event) => {
      window.localStorage.setItem(TICKER_VISIBLE_STORAGE_KEY, String(event.payload));
    }).then((stop) => {
      stopVisibility = stop;
    });
    void listen<number>(TICKER_OPACITY_CHANGED_EVENT, (event) => {
      setOpacity(event.payload);
    }).then((stop) => {
      stopOpacity = stop;
    });
    void listen<string>(TICKER_FONT_COLOR_CHANGED_EVENT, (event) => {
      if (isTickerFontColor(event.payload)) {
        setFontColor(event.payload);
      }
    }).then((stop) => {
      stopFontColor = stop;
    });
    void listen<number>(TICKER_FONT_SIZE_CHANGED_EVENT, (event) => {
      if (isTickerFontSize(event.payload)) {
        setFontSize(event.payload);
      }
    }).then((stop) => {
      stopFontSize = stop;
    });
    return () => {
      cancelled = true;
      stopStocks?.();
      stopPosition?.();
      stopVisibility?.();
      stopOpacity?.();
      stopFontColor?.();
      stopFontSize?.();
    };
  }, []);

  useEffect(() => {
    setCodes("ticker-overlay", stocks.map((stock) => stock.code));
  }, [setCodes, stocks]);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) {
      return;
    }
    const measuredOverlay = overlay;

    function resizeToContent() {
      const rect = measuredOverlay.getBoundingClientRect();
      const width = Math.ceil(rect.width);
      const height = Math.ceil(rect.height);
      if (width > 0 && height > 0) {
        void invoke("resize_ticker_window", { width, height });
      }
    }

    resizeToContent();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(resizeToContent);
    observer.observe(measuredOverlay);
    return () => observer.disconnect();
  }, [fontSize, quotes, stocks]);

  return (
    <main
      ref={overlayRef}
      className="ticker-overlay"
      style={{ color: fontColor, fontSize: `${fontSize}px`, opacity: opacity / 100 }}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        const previous = lastPointerDownRef.current;
        const isDoubleClick = previous != null
          && event.timeStamp - previous.time <= DOUBLE_CLICK_INTERVAL_MS
          && Math.abs(event.screenX - previous.x) <= DOUBLE_CLICK_DISTANCE_PX
          && Math.abs(event.screenY - previous.y) <= DOUBLE_CLICK_DISTANCE_PX;
        if (isDoubleClick) {
          lastPointerDownRef.current = null;
          window.localStorage.setItem(TICKER_VISIBLE_STORAGE_KEY, "false");
          void invoke("set_ticker_visibility", { visible: false });
          return;
        }
        lastPointerDownRef.current = { time: event.timeStamp, x: event.screenX, y: event.screenY };
        void invoke("start_ticker_dragging");
      }}
    >
      {stocks.length ? (
        <div className="ticker-grid" role="table" aria-label="Stock ticker">
          {stocks.map((stock) => {
            const quote = quotes[stock.code];
            const alarm = alarmActive(stock, quote?.now);
            return (
              <div className="ticker-row" role="row" key={stock.code}>
                <span className={`ticker-name${alarm ? " ticker-alarm" : ""}`} role="cell">
                  {displayStockName(stock.name)}
                </span>
                <span role="cell">{quote ? quote.now.toFixed(pricePrecision(stock.code)) : "—"}</span>
                <span role="cell">{quote ? formatPercent(quote.percent) : "—"}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="ticker-empty">{t("ticker.empty")}</p>
      )}
    </main>
  );
}

export function TickerOverlay() {
  return (
    <LanguageProvider>
      <PriceFeedProvider coordinator={false}>
        <TickerOverlayContent />
      </PriceFeedProvider>
    </LanguageProvider>
  );
}

interface PointerDrag {
  pointerId: number;
  index: number;
  startY: number;
  active: boolean;
}

function TickerSettingsContent({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const { quotes: managedQuotes, setCodes } = usePriceFeed();
  const [stocks, setStocks] = useState<TickerStock[]>([]);
  const [ledgerStocks, setLedgerStocks] = useState<StockOption[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockOption[]>([]);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const dragRef = useRef<PointerDrag | null>(null);
  const searchComboboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void Promise.all([
      invoke<TickerStock[]>("load_ticker_stocks"),
      invoke<StockLedger[]>("load_stock_ledgers"),
    ])
      .then(([loadedStocks, ledgers]) => {
        setStocks(loadedStocks);
        setLedgerStocks(ledgers.map(({ code, name }) => ({ code, name })));
      })
      .catch((loadError) => setError(String(loadError)));
  }, []);

  useEffect(() => {
    setCodes("ticker-dialog", stocks.map((stock) => stock.code));
    return () => setCodes("ticker-dialog", []);
  }, [setCodes, stocks]);

  useEffect(() => {
    if (!resultsOpen) {
      return;
    }
    const closeWhenClickedOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !searchComboboxRef.current?.contains(event.target)) {
        setResultsOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeWhenClickedOutside);
    return () => document.removeEventListener("pointerdown", closeWhenClickedOutside);
  }, [resultsOpen]);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) {
      setResults(ledgerStocks);
      setResultsOpen(true);
      return;
    }
    setSearching(true);
    setError("");
    try {
      setResults(await searchAnyStocks(query));
      setResultsOpen(true);
    } catch (searchError) {
      setResults([]);
      setResultsOpen(true);
      setError(t("ticker.searchError", { error: String(searchError) }));
    } finally {
      setSearching(false);
    }
  }

  function addStock(stock: StockOption) {
    setStocks((current) => current.some((item) => item.code === stock.code)
      ? current
      : [...current, { ...stock, lower: "", upper: "" }]);
  }

  function moveStock(from: number, to: number) {
    if (from === to || to < 0 || to >= stocks.length) {
      return;
    }
    setStocks((current) => {
      const next = [...current];
      const [stock] = next.splice(from, 1);
      next.splice(to, 0, stock);
      return next;
    });
  }

  function beginPointerDrag(event: ReactPointerEvent<HTMLLIElement>, index: number) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input")) {
      return;
    }
    event.preventDefault();
    dragRef.current = { pointerId: event.pointerId, index, startY: event.clientY, active: false };
  }

  function continuePointerDrag(event: ReactPointerEvent<HTMLLIElement>, targetIndex: number) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (!drag.active && Math.abs(event.clientY - drag.startY) < 5) {
      return;
    }
    drag.active = true;
    setDraggingIndex(drag.index);
    if (drag.index !== targetIndex) {
      moveStock(drag.index, targetIndex);
      drag.index = targetIndex;
      setDraggingIndex(targetIndex);
    }
  }

  function endPointerDrag() {
    dragRef.current = null;
    setDraggingIndex(null);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await invoke("save_ticker_stocks", { stocks });
      onClose();
    } catch (saveError) {
      setError(t("ticker.saveError", { error: String(saveError) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="dialog ticker"
      role="dialog"
      aria-label={t("ticker.settingsTitle")}
      onPointerUp={endPointerDrag}
      onPointerCancel={endPointerDrag}
    >
      <header>
        <h2>{t("ticker.settingsTitle")}</h2>
        <button type="button" className="ticker-close" onClick={onClose} aria-label={t("dialog.close")}>×</button>
      </header>
      <form className="ticker-search" onSubmit={search}>
        <div className="ticker-search-combobox" ref={searchComboboxRef}>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder={t("ticker.searchPlaceholder")}
            aria-label={t("ticker.searchPlaceholder")}
            role="combobox"
            aria-expanded={resultsOpen}
            aria-controls="ticker-stock-options"
            aria-autocomplete="list"
          />
          <button
            type="button"
            className="ticker-search-toggle"
            aria-label={t("dialog.showExistingStocks")}
            onClick={() => {
              setResults(ledgerStocks);
              setError("");
              setResultsOpen(true);
            }}
          >
            ▾
          </button>
          {resultsOpen && (
            <ul id="ticker-stock-options" className="ticker-results" role="listbox">
              {results.map((stock) => {
                const added = stocks.some((item) => item.code === stock.code);
                return (
                  <li key={stock.code} role="option" aria-selected={added}>
                    <button
                      type="button"
                      className="ticker-result-option"
                      aria-label={added ? t("ticker.added") : t("ticker.add")}
                      disabled={added}
                      onClick={() => addStock(stock)}
                    >
                      <span>{stock.name} ({displayStockCode(stock.code)})</span>
                      <span className="ticker-result-state">{added ? t("ticker.added") : t("ticker.add")}</span>
                    </button>
                  </li>
                );
              })}
              {!results.length && !error && (
                <li className="ticker-no-options">{t("ticker.noResults")}</li>
              )}
            </ul>
          )}
        </div>
        <button type="submit" disabled={searching}>
          {searching ? t("ticker.searching") : t("ticker.search")}
        </button>
      </form>
      <section className="ticker-managed">
        {stocks.length ? (
          <ol className="ticker-stock-list">
            {stocks.map((stock, index) => {
              const quote = managedQuotes[stock.code];
              const changeClass = quote
                ? quote.percent > 0
                  ? " ticker-price-gain"
                  : quote.percent < 0
                    ? " ticker-price-loss"
                    : ""
                : "";
              return (
              <li
                key={stock.code}
                className={draggingIndex === index ? "dragging" : undefined}
                onPointerDown={(event) => beginPointerDrag(event, index)}
                onPointerMove={(event) => continuePointerDrag(event, index)}
                onPointerUp={endPointerDrag}
                onPointerCancel={endPointerDrag}
              >
                <span className="ticker-stock-name">{displayStockName(stock.name)}</span>
                <span className={`ticker-managed-quote${changeClass}`}>
                  {quote ? `${quote.now.toFixed(pricePrecision(stock.code))} / ${formatPercent(quote.percent)}` : "—"}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={t("ticker.lower")}
                  aria-label={`${t("ticker.lower")} ${stock.name}`}
                  value={stock.lower}
                  onChange={(event) => setStocks((current) => current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, lower: event.target.value } : item))}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={t("ticker.upper")}
                  aria-label={`${t("ticker.upper")} ${stock.name}`}
                  value={stock.upper}
                  onChange={(event) => setStocks((current) => current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, upper: event.target.value } : item))}
                />
                <div className="ticker-row-actions">
                  <button type="button" disabled={index === 0} onClick={() => moveStock(index, index - 1)} aria-label={`${t("ticker.moveUp")} ${stock.name}`}>↑</button>
                  <button type="button" disabled={index === stocks.length - 1} onClick={() => moveStock(index, index + 1)} aria-label={`${t("ticker.moveDown")} ${stock.name}`}>↓</button>
                  <button type="button" className="ticker-delete" onClick={() => setStocks((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`${t("ticker.delete")} ${stock.name}`}>×</button>
                </div>
              </li>
              );
            })}
          </ol>
        ) : (
          <p className="ticker-empty-message">{t("ticker.noStocks")}</p>
        )}
      </section>
      {error && <p className="ticker-error-message" role="alert">{error}</p>}
      <footer>
        <button type="button" onClick={onClose}>{t("dialog.cancel")}</button>
        <button type="button" className="ticker-primary" disabled={saving} onClick={() => void save()}>
          {saving ? t("dialog.saving") : t("dialog.save")}
        </button>
      </footer>
    </section>
  );
}

export function TickerSettingsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <TickerSettingsContent onClose={onClose} />
    </div>
  );
}

export function TickerSettings({ onClose = () => undefined }: { onClose?: () => void }) {
  return (
    <LanguageProvider>
      <PriceFeedProvider>
        <TickerSettingsDialog onClose={onClose} />
      </PriceFeedProvider>
    </LanguageProvider>
  );
}
