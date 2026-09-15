import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FormEvent, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  computeNetProfit,
  DEFAULT_PROFIT_SETTINGS,
  pricePrecision,
  toTableRows,
  type ProfitSettings,
  type StockLedger,
  type StockOption,
  type TableRow,
} from "./ledger";
import { searchStocks, type StockQuote } from "./stockApi";
import { version as appVersion } from "../package.json";
import { formatRecordCount, isLanguagePreference, useLanguage, type LanguageContextValue, type LanguagePreference } from "./i18n";
import { LanguageProvider } from "./LanguageProvider";
import { DEFAULT_REFRESH_SECONDS, MIN_REFRESH_SECONDS, PriceFeedProvider, usePriceFeed } from "./PriceFeedProvider";
import { ProfitSettingsProvider, useProfitSettings } from "./ProfitSettingsProvider";
import "./App.css";

type StatusFilter = "all" | "alerted" | "open" | "closed";
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

function netProfitFor(row: TableRow, settings: ProfitSettings): number | null {
  if (row.quantity == null || row.buyPrice == null || row.sellPrice == null) {
    return null;
  }
  return computeNetProfit(row.code, row.quantity, row.buyPrice, row.sellPrice, settings);
}

function formatNetProfit(row: TableRow, settings: ProfitSettings): string {
  const profit = netProfitFor(row, settings);
  return profit == null ? "" : profit.toFixed(2);
}

function formatTotalProfit(rows: TableRow[], settings: ProfitSettings): string {
  const total = rows.reduce((sum, row) => sum + (netProfitFor(row, settings) ?? 0), 0);
  return total.toFixed(2);
}

function isValidOpenBuy(row: TableRow): boolean {
  return row.quantity != null && row.buyPrice != null && row.buyDate != null && row.sellPrice == null;
}

function isValidOpenSell(row: TableRow): boolean {
  return row.quantity != null && row.sellPrice != null && row.sellDate != null && row.buyPrice == null;
}

interface StockSummary {
  name: string;
  code: string;
  quantity: number;
  averageCost: number | null;
  averageCostChangePercent: number | null;
  marketValue: number | null;
  gainLoss: number | null;
}

function computeStockSummary(rows: TableRow[], quote: StockQuote | undefined): StockSummary | null {
  if (!rows.length) {
    return null;
  }
  const openBuyRows = rows.filter(isValidOpenBuy);
  const openSellRows = rows.filter(isValidOpenSell);
  const openBuyQuantity = openBuyRows.reduce((sum, row) => sum + (row.quantity ?? 0), 0);
  const openSellQuantity = openSellRows.reduce((sum, row) => sum + (row.quantity ?? 0), 0);
  const quantity = openBuyQuantity - openSellQuantity;
  const averageCost = openBuyQuantity
    ? openBuyRows.reduce((sum, row) => sum + (row.buyPrice ?? 0) * (row.quantity ?? 0), 0) / openBuyQuantity
    : null;
  const averageCostChangePercent = quote && averageCost
    ? ((quote.now - averageCost) / averageCost) * 100
    : null;
  const marketValue = quote ? quantity * quote.now : null;
  const gainLoss = quote
    ? openBuyRows.reduce((sum, row) => sum + (quote.now - (row.buyPrice ?? 0)) * (row.quantity ?? 0), 0) +
      openSellRows.reduce((sum, row) => sum + ((row.sellPrice ?? 0) - quote.now) * (row.quantity ?? 0), 0)
    : null;
  return {
    name: rows[0].name,
    code: rows[0].code,
    quantity,
    averageCost,
    averageCostChangePercent,
    marketValue,
    gainLoss,
  };
}

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day)
    ? date
    : null;
}

function monthsBefore(date: Date, months: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth() - months, 1);
  result.setDate(Math.min(date.getDate(), new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()));
  return result;
}

function formatTableDate(value: string | undefined, t: LanguageContextValue["t"]): string {
  if (!value) {
    return "";
  }
  const date = parseLocalDate(value);
  if (!date) {
    return value;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const oneDayAgo = new Date(today);
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  const twoDaysAgo = new Date(today);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const twoWeeksAgo = new Date(today);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  if (date > today || date < monthsBefore(today, 24)) {
    return value;
  }
  if (date >= today) return t("table.dateToday");
  if (date >= oneDayAgo) return t("table.dateDayAgo");
  if (date >= twoDaysAgo) return t("table.dateTwoDaysAgo");
  if (date > weekAgo) return t("table.dateThreeDaysAgo");
  if (date > twoWeeksAgo) return t("table.dateWeekAgo");
  if (date > monthsBefore(today, 1)) return t("table.dateTwoWeeksAgo");
  if (date > monthsBefore(today, 2)) return t("table.dateMonthAgo");
  if (date > monthsBefore(today, 3)) return t("table.dateTwoMonthsAgo");
  if (date > monthsBefore(today, 6)) return t("table.dateThreeMonthsAgo");
  if (date > monthsBefore(today, 12)) return t("table.dateSixMonthsAgo");
  return t("table.dateYearAgo");
}

function profitChangePercent(row: TableRow, settings: ProfitSettings): number | null {
  if (row.quantity == null || row.buyPrice == null || row.buyPrice === 0) {
    return null;
  }
  const netProfit = netProfitFor(row, settings);
  return netProfit == null ? null : netProfit / (row.buyPrice * row.quantity);
}

const UP_STEPS = Array.from({ length: 10 }, (_, index) => index + 1);
const DOWN_STEPS = Array.from({ length: 10 }, (_, index) => -(index + 1));
const HOVER_POPUP_DELAY_MS = 500;
const DATA_DIRECTORY_STORAGE_KEY = "littlev-stock-data-directory";
const PRICE_ALERT_SETTINGS_STORAGE_KEY = "littlev-price-alert-settings";
const DEFAULT_PRICE_ALERT_PERCENT = 3;

interface PriceAlertSettings {
  gainPercent: number;
  lossPercent: number;
}

function loadPriceAlertSettings(): PriceAlertSettings {
  const stored = window.localStorage.getItem(PRICE_ALERT_SETTINGS_STORAGE_KEY);
  if (!stored) {
    return { gainPercent: DEFAULT_PRICE_ALERT_PERCENT, lossPercent: DEFAULT_PRICE_ALERT_PERCENT };
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Number.isFinite((parsed as PriceAlertSettings).gainPercent) &&
      (parsed as PriceAlertSettings).gainPercent >= 0 &&
      Number.isFinite((parsed as PriceAlertSettings).lossPercent) &&
      (parsed as PriceAlertSettings).lossPercent >= 0
    ) {
      return parsed as PriceAlertSettings;
    }
  } catch {
    // Use defaults when the saved preference cannot be read.
  }
  return { gainPercent: DEFAULT_PRICE_ALERT_PERCENT, lossPercent: DEFAULT_PRICE_ALERT_PERCENT };
}

function quoteChangeClass(quote: StockQuote): string {
  if (quote.percent > 0) {
    return "price-gain";
  }
  if (quote.percent < 0) {
    return "price-loss";
  }
  return "";
}

function formatQuotePercent(quote: StockQuote): string {
  const percent = quote.percent * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

function formatSignedPercent(percent: number): string {
  return `${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

function signedChangeClass(value: number): string {
  if (value > 0) {
    return "price-gain";
  }
  if (value < 0) {
    return "price-loss";
  }
  return "";
}

function displayStockName(name: string): string {
  return name.replace(/(?:ETF|LOF).*$/i, "").trimEnd();
}

function displayStockCode(code: string): string {
  return code.replace(/^[A-Za-z]+/, "");
}

function referenceChange(quote: StockQuote, referencePrice: number, isSellPrice: boolean): number {
  return isSellPrice ? referencePrice - quote.now : quote.now - referencePrice;
}

function formatReferenceChange(
  quote: StockQuote,
  referencePrice: number,
  isSellPrice: boolean,
  precision: number,
): string {
  const change = referenceChange(quote, referencePrice, isSellPrice);
  const percent = referencePrice !== 0 ? (change / referencePrice) * 100 : 0;
  const amount = `${change > 0 ? "+" : ""}${change.toFixed(precision)}`;
  const percentText = `${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
  return `${amount} / ${percentText}`;
}

function formatReferenceProfit(
  quote: StockQuote,
  referencePrice: number,
  isSellPrice: boolean,
  quantity: number | null | undefined,
): string {
  if (quantity == null) {
    return "";
  }
  const profit = referenceChange(quote, referencePrice, isSellPrice) * quantity;
  return `${profit > 0 ? "+" : ""}${profit.toFixed(2)}`;
}

function referenceChangeClass(quote: StockQuote, referencePrice: number, isSellPrice: boolean): string {
  if (referenceChange(quote, referencePrice, isSellPrice) > 0) {
    return "price-gain";
  }
  if (referenceChange(quote, referencePrice, isSellPrice) < 0) {
    return "price-loss";
  }
  return "";
}

function priceAlertClasses(
  rows: TableRow[],
  quotes: Record<string, StockQuote>,
  settings: PriceAlertSettings,
): Map<string, { buy?: string; sell?: string }> {
  const alerts = new Map<string, { buy?: string; sell?: string }>();
  const openRowsByCode = new Map<string, TableRow[]>();
  for (const row of rows) {
    if (!isRowClosed(row)) {
      openRowsByCode.set(row.code, [...(openRowsByCode.get(row.code) ?? []), row]);
    }
  }

  for (const [code, openRows] of openRowsByCode) {
    const quote = quotes[code];
    if (!quote) {
      continue;
    }
    const datedBuyRows = openRows.filter((row) => row.buyPrice != null && row.buyDate);
    const lowestDatedBuy = datedBuyRows.length
      ? Math.min(...datedBuyRows.map((row) => row.buyPrice as number))
      : undefined;
    if (lowestDatedBuy != null) {
      datedBuyRows.filter((row) => row.buyPrice === lowestDatedBuy).forEach((row) => {
        if (quote.now < lowestDatedBuy * (1 - settings.lossPercent / 100)) {
          alerts.set(row.key, { ...alerts.get(row.key), buy: "price-alert-loss" });
        } else if (quote.now > lowestDatedBuy * (1 + settings.gainPercent / 100)) {
          alerts.set(row.key, { ...alerts.get(row.key), buy: "price-alert-gain" });
        }
      });
    }

    const undatedBuyRows = openRows.filter((row) => row.buyPrice != null && !row.buyDate);
    const lowestUndatedBuy = undatedBuyRows.length
      ? Math.min(...undatedBuyRows.map((row) => row.buyPrice as number))
      : undefined;
    if (lowestUndatedBuy != null && quote.now < lowestUndatedBuy) {
      undatedBuyRows
        .filter((row) => row.buyPrice === lowestUndatedBuy)
        .forEach((row) => alerts.set(row.key, { ...alerts.get(row.key), buy: "price-alert-loss" }));
    }

    const datedSellRows = openRows.filter((row) => row.sellPrice != null && row.sellDate);
    const highestDatedSell = datedSellRows.length
      ? Math.max(...datedSellRows.map((row) => row.sellPrice as number))
      : undefined;
    if (highestDatedSell != null && quote.now < highestDatedSell * (1 - settings.lossPercent / 100)) {
      datedSellRows
        .filter((row) => row.sellPrice === highestDatedSell)
        .forEach((row) => alerts.set(row.key, { ...alerts.get(row.key), sell: "price-alert-gain" }));
    }

    const undatedSellRows = openRows.filter((row) => row.sellPrice != null && !row.sellDate);
    const highestUndatedSell = undatedSellRows.length
      ? Math.max(...undatedSellRows.map((row) => row.sellPrice as number))
      : undefined;
    if (highestUndatedSell != null && quote.now > highestUndatedSell) {
      undatedSellRows
        .filter((row) => row.sellPrice === highestUndatedSell)
        .forEach((row) => {
          alerts.set(row.key, { ...alerts.get(row.key), sell: "price-alert-gain" });
        });
    }
  }
  return alerts;
}

function CurrentQuoteRow({
  quote,
  referencePrice,
  isSellPrice,
  quantity,
  precision,
  name,
}: {
  quote: StockQuote;
  referencePrice: number;
  isSellPrice: boolean;
  quantity: number | null | undefined;
  precision: number;
  name?: string;
}) {
  return (
    <div className="current-quote">
      <span className={`current-quote-market ${quoteChangeClass(quote)}`}>
        {quote.now.toFixed(precision)} / {formatQuotePercent(quote)}
      </span>
      {name && <span className="current-quote-name">{displayStockName(name)}</span>}
      <span className={`current-quote-reference ${referenceChangeClass(quote, referencePrice, isSellPrice)}`}>
        <span className="current-quote-reference-profit">
          {formatReferenceProfit(quote, referencePrice, isSellPrice, quantity)}
        </span>
        <span className="current-quote-reference-change">
          {formatReferenceChange(quote, referencePrice, isSellPrice, precision)}
        </span>
      </span>
    </div>
  );
}

function PriceCell({
  price,
  code,
  name,
  quantity,
  isSellPrice,
  alertClass,
}: {
  price: number | null | undefined;
  code: string;
  name: string;
  quantity: number | null | undefined;
  isSellPrice: boolean;
  alertClass?: string;
}) {
  const { quotes } = usePriceFeed();
  const [visible, setVisible] = useState(false);
  const [showAbove, setShowAbove] = useState(false);
  const timerRef = useRef<number | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  function clearTimer() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function handleMouseEnter() {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      setShowAbove(false);
      setVisible(true);
    }, HOVER_POPUP_DELAY_MS);
  }

  function handleMouseLeave() {
    clearTimer();
    setVisible(false);
    setShowAbove(false);
  }

  useEffect(() => clearTimer, []);

  useLayoutEffect(() => {
    if (!visible || !popupRef.current) {
      return;
    }
    setShowAbove(popupRef.current.getBoundingClientRect().bottom > window.innerHeight);
  }, [visible]);

  if (price == null) {
    return <td></td>;
  }
  const precision = pricePrecision(code);
  const quote = quotes[code];
  const nearestStep = quote
    ? [...UP_STEPS, ...DOWN_STEPS].reduce<{ pct: number | null; diff: number }>(
        (best, pct) => {
          const diff = Math.abs(price * (1 + pct / 100) - quote.now);
          return diff < best.diff ? { pct, diff } : best;
        },
        { pct: null, diff: Infinity },
      ).pct
    : null;
  return (
    <td className={`price-cell${alertClass ? ` ${alertClass}` : ""}`} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {price.toFixed(precision)}
      {visible && (
        <div ref={popupRef} className={`price-popup${showAbove ? " price-popup-above" : ""}`} role="tooltip">
          {quote && (
            <CurrentQuoteRow
              quote={quote}
              referencePrice={price}
              isSellPrice={isSellPrice}
              quantity={quantity}
              precision={precision}
              name={name}
            />
          )}
          <table>
            <thead>
              <tr>
                {[...UP_STEPS].reverse().map((pct) => (
                  <th key={pct} className={pct === nearestStep ? "nearest-price price-gain" : ""}>+{pct}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {[...UP_STEPS].reverse().map((pct) => (
                  <td key={pct} className={pct === nearestStep ? "nearest-price price-gain" : ""}>{(price * (1 + pct / 100)).toFixed(precision)}</td>
                ))}
              </tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                {DOWN_STEPS.map((pct) => (
                  <th key={pct} className={pct === nearestStep ? "nearest-price price-loss" : ""}>{pct}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {DOWN_STEPS.map((pct) => (
                  <td key={pct} className={pct === nearestStep ? "nearest-price price-loss" : ""}>{(price * (1 + pct / 100)).toFixed(precision)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </td>
  );
}

function ProfitCell({ row, settings }: { row: TableRow; settings: ProfitSettings }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);
  const changePercent = profitChangePercent(row, settings);

  function clearTimer() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function handleMouseEnter() {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      setVisible(true);
    }, HOVER_POPUP_DELAY_MS);
  }

  function handleMouseLeave() {
    clearTimer();
    setVisible(false);
  }

  useEffect(() => clearTimer, []);

  const profit = formatNetProfit(row, settings);
  return (
    <td className="profit-cell" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {profit}
      {visible && changePercent != null && (
        <div className={`profit-tooltip ${changePercent > 0 ? "price-gain" : changePercent < 0 ? "price-loss" : ""}`} role="tooltip">
          {`${changePercent > 0 ? "+" : ""}${(changePercent * 100).toFixed(2)}%`}
        </div>
      )}
    </td>
  );
}

function NameCell({ row }: { row: TableRow }) {
  const { quotes } = usePriceFeed();
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);
  const [showAbove, setShowAbove] = useState(false);
  const timerRef = useRef<number | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const quote = quotes[row.code];

  function clearTimer() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function handleMouseEnter() {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      setShowAbove(false);
      setVisible(true);
    }, HOVER_POPUP_DELAY_MS);
  }

  function handleMouseLeave() {
    clearTimer();
    setVisible(false);
    setShowAbove(false);
  }

  useEffect(() => clearTimer, []);

  useLayoutEffect(() => {
    if (!visible || !tooltipRef.current) {
      return;
    }
    setShowAbove(tooltipRef.current.getBoundingClientRect().bottom > window.innerHeight);
  }, [visible]);

  return (
    <td className="name-cell">
      <span className="stock-name" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        {displayStockName(row.name)}
        {visible && (
          <div ref={tooltipRef} className={`name-tooltip${showAbove ? " name-tooltip-above" : ""}`} role="tooltip">
            <div>{row.name}</div>
            <div>{displayStockCode(row.code)}</div>
            {quote && (
              <div className={quoteChangeClass(quote)}>
                {quote.now.toFixed(pricePrecision(row.code))} / {formatQuotePercent(quote)}
              </div>
            )}
          </div>
        )}
      </span>
      {row.note && (
        <span className="comment-indicator" title={row.note} aria-label={t("table.note", { note: row.note })}>
          💬
        </span>
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

interface SettingsDraft {
  dataDirectory: string;
  languagePreference: string;
  refreshIntervalSeconds: string;
  feeRatePercent: string;
  minFee: string;
  stampDutyRatePercent: string;
  alertGainPercent: string;
  alertLossPercent: string;
}

function draftFromSettings(
  dataDirectory: string,
  languagePreference: string,
  refreshIntervalSeconds: number,
  profitSettings: ProfitSettings,
  priceAlertSettings: PriceAlertSettings,
): SettingsDraft {
  return {
    dataDirectory,
    languagePreference,
    refreshIntervalSeconds: String(refreshIntervalSeconds),
    feeRatePercent: String(profitSettings.feeRate * 100),
    minFee: String(profitSettings.minFee),
    stampDutyRatePercent: String(profitSettings.stampDutyRate * 100),
    alertGainPercent: String(priceAlertSettings.gainPercent),
    alertLossPercent: String(priceAlertSettings.lossPercent),
  };
}

function App() {
  return (
    <LanguageProvider>
      <PriceFeedProvider>
        <ProfitSettingsProvider>
          <AppContent />
        </ProfitSettingsProvider>
      </PriceFeedProvider>
    </LanguageProvider>
  );
}

function AppContent() {
  const {
    language,
    languagePreference,
    setLanguagePreference,
    previewLanguagePreference,
    clearLanguagePreview,
    t,
  } = useLanguage();
  const { quotes, setCodes, refreshIntervalSeconds, setRefreshIntervalSeconds } = usePriceFeed();
  const { profitSettings, setProfitSettings } = useProfitSettings();
  const [priceAlertSettings, setPriceAlertSettings] = useState<PriceAlertSettings>(loadPriceAlertSettings);
  const [ledgers, setLedgers] = useState<StockLedger[]>([]);
  const [selectedStockName, setSelectedStockName] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<TableRow | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dataDirectory, setDataDirectory] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>(() =>
    draftFromSettings("", languagePreference, refreshIntervalSeconds, profitSettings, priceAlertSettings),
  );
  const [settingsError, setSettingsError] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ code: string; uuid: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openSettings() {
    clearLanguagePreview();
    setSettingsError("");
    setSettingsDraft(draftFromSettings(dataDirectory, languagePreference, refreshIntervalSeconds, profitSettings, priceAlertSettings));
    setSettingsOpen(true);
  }

  async function resetSettingsDraftToDefault() {
    try {
      const defaultDataDirectory = await invoke<string>("get_default_data_directory");
      setSettingsDraft(draftFromSettings(
        defaultDataDirectory,
        "system",
        DEFAULT_REFRESH_SECONDS,
        DEFAULT_PROFIT_SETTINGS,
        { gainPercent: DEFAULT_PRICE_ALERT_PERCENT, lossPercent: DEFAULT_PRICE_ALERT_PERCENT },
      ));
      setSettingsError("");
    } catch (error) {
      setSettingsError(String(error));
    }
    previewLanguagePreference("system");
  }

  function dismissSettings() {
    clearLanguagePreview();
    setSettingsError("");
    setSettingsOpen(false);
  }

  async function saveSettings() {
    const refreshSeconds = Number(settingsDraft.refreshIntervalSeconds);
    const feeRatePercent = Number(settingsDraft.feeRatePercent);
    const minFee = Number(settingsDraft.minFee);
    const stampDutyRatePercent = Number(settingsDraft.stampDutyRatePercent);
    const alertGainPercent = Number(settingsDraft.alertGainPercent);
    const alertLossPercent = Number(settingsDraft.alertLossPercent);
    if (
      !isLanguagePreference(settingsDraft.languagePreference) ||
      !settingsDraft.dataDirectory.trim() ||
      !Number.isFinite(refreshSeconds) ||
      refreshSeconds < MIN_REFRESH_SECONDS ||
      ![feeRatePercent, minFee, stampDutyRatePercent, alertGainPercent, alertLossPercent]
        .every((value) => Number.isFinite(value) && value >= 0)
    ) {
      setSettingsError(t("settings.invalidValues"));
      return;
    }

    setSavingSettings(true);
    try {
      const selectedDirectory = await invoke<string>("set_data_directory", {
        directory: settingsDraft.dataDirectory.trim(),
      });
      window.localStorage.setItem(DATA_DIRECTORY_STORAGE_KEY, selectedDirectory);
      setDataDirectory(selectedDirectory);
      setLanguagePreference(settingsDraft.languagePreference as LanguagePreference);
      setRefreshIntervalSeconds(Math.round(refreshSeconds));
      setProfitSettings({
        feeRate: feeRatePercent / 100,
        minFee,
        stampDutyRate: stampDutyRatePercent / 100,
      });
      const nextPriceAlertSettings = { gainPercent: alertGainPercent, lossPercent: alertLossPercent };
      setPriceAlertSettings(nextPriceAlertSettings);
      window.localStorage.setItem(PRICE_ALERT_SETTINGS_STORAGE_KEY, JSON.stringify(nextPriceAlertSettings));
      clearLanguagePreview();
      setSettingsOpen(false);
      setSettingsError("");
      await loadLedgers();
    } catch (error) {
      setSettingsError(String(error));
    } finally {
      setSavingSettings(false);
    }
  }

  async function chooseDataDirectory() {
    const directory = await open({
      defaultPath: settingsDraft.dataDirectory || undefined,
      directory: true,
      multiple: false,
      title: t("settings.selectDataDirectory"),
    });
    if (typeof directory === "string") {
      setSettingsDraft((draft) => ({ ...draft, dataDirectory: directory }));
    }
  }

  const loadLedgers = async () => {
    try {
      setLedgers(await invoke<StockLedger[]>("load_stock_ledgers"));
      setLoadError("");
    } catch (error) {
      setLoadError(String(error));
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function initializeDataDirectory() {
      try {
        const storedDirectory = window.localStorage.getItem(DATA_DIRECTORY_STORAGE_KEY);
        const directory = storedDirectory
          ? await invoke<string>("set_data_directory", { directory: storedDirectory })
          : await invoke<string>("get_data_directory");
        if (!cancelled) {
          setDataDirectory(directory);
          await loadLedgers();
        }
      } catch (error) {
        if (!cancelled) {
          window.localStorage.removeItem(DATA_DIRECTORY_STORAGE_KEY);
          setLoadError(String(error));
          await loadLedgers();
        }
      }
    }
    void initializeDataDirectory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("stock-ledgers-changed", () => {
      void loadLedgers();
    }).then((stopListening) => {
      unlisten = stopListening;
    }).catch((error) => {
      setLoadError(String(error));
    });
    return () => {
      unlisten?.();
    };
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

  useEffect(() => {
    // Poll every code present in the ledger, regardless of active filters.
    setCodes([...new Set(allRows.map((row) => row.code))]);
  }, [allRows, setCodes]);

  const filterNames = useMemo(
    () => [...new Set(allRows.map((row) => row.name))].sort((left, right) => left.localeCompare(right)),
    [allRows],
  );
  const alerts = useMemo(
    () => priceAlertClasses(allRows, quotes, priceAlertSettings),
    [allRows, quotes, priceAlertSettings],
  );
  const stockSummary = useMemo(() => {
    if (selectedStockName === null) {
      return null;
    }
    const stockRows = allRows.filter((row) => row.name === selectedStockName);
    return computeStockSummary(stockRows, quotes[stockRows[0]?.code]);
  }, [allRows, selectedStockName, quotes]);
  function matchesFilters(row: TableRow): boolean {
    if (selectedStockName !== null && row.name !== selectedStockName) {
      return false;
    }
    const isClosed = isRowClosed(row);
    if (statusFilter === "alerted" && !alerts.get(row.key)) {
      return false;
    }
    if (statusFilter === "open" && isClosed) {
      return false;
    }
    if (statusFilter === "closed" && !isClosed) {
      return false;
    }
    const cutoff = periodCutoff(periodFilter);
    if (cutoff) {
      const recentDate = mostRecentDate(row);
      if (recentDate && recentDate < cutoff) {
        return false;
      }
    }
    return true;
  }

  // Keeps each row's display position stable across edits (new rows are
  // inserted at their sorted position; only deletions remove a row), and
  // temporarily keeps a row visible if an edit makes it stop matching the
  // active filters, until the filters themselves are changed. Changing any
  // filter re-applies the full sort order and re-evaluates visibility.
  const filterSignature = `${selectedStockName ?? ""}|${statusFilter}|${periodFilter}`;
  const [displayState, setDisplayState] = useState<{ order: string[]; visible: Set<string> }>({
    order: [],
    visible: new Set(),
  });
  const seenKeysRef = useRef<Set<string>>(new Set());
  const prevFilterSignatureRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const filterChanged = prevFilterSignatureRef.current !== filterSignature;
    prevFilterSignatureRef.current = filterSignature;

    const currentKeys = new Set(allRows.map((row) => row.key));
    const rowByKey = new Map(allRows.map((row) => [row.key, row]));
    const previouslySeen = seenKeysRef.current;
    const sortedKeys = allRows.map((row) => row.key);

    setDisplayState((prev) => {
      const priorOrder = prev.order.filter((key) => currentKeys.has(key));
      const priorSet = new Set(priorOrder);

      let nextOrder: string[];
      if (filterChanged || prev.order.length === 0) {
        nextOrder = sortedKeys;
      } else {
        const insertAfter = new Map<string, string | null>();
        let lastOldKey: string | null = null;
        for (const key of sortedKeys) {
          if (priorSet.has(key)) {
            lastOldKey = key;
          } else {
            insertAfter.set(key, lastOldKey);
          }
        }
        const groups = new Map<string | null, string[]>();
        for (const key of sortedKeys) {
          if (!priorSet.has(key)) {
            const anchor = insertAfter.get(key) ?? null;
            if (!groups.has(anchor)) {
              groups.set(anchor, []);
            }
            groups.get(anchor)!.push(key);
          }
        }
        nextOrder = [];
        if (groups.has(null)) {
          nextOrder.push(...groups.get(null)!);
        }
        for (const key of priorOrder) {
          nextOrder.push(key);
          if (groups.has(key)) {
            nextOrder.push(...groups.get(key)!);
          }
        }
      }

      let nextVisible: Set<string>;
      if (filterChanged || prev.order.length === 0) {
        nextVisible = new Set(allRows.filter(matchesFilters).map((row) => row.key));
      } else {
        nextVisible = new Set<string>();
        for (const key of nextOrder) {
          if (previouslySeen.has(key)) {
            if (prev.visible.has(key)) {
              nextVisible.add(key);
            }
          } else {
            const row = rowByKey.get(key);
            if (row && matchesFilters(row)) {
              nextVisible.add(key);
            }
          }
        }
      }

      return { order: nextOrder, visible: nextVisible };
    });

    seenKeysRef.current = currentKeys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, filterSignature]);

  const rows = useMemo(() => {
    const rowByKey = new Map(allRows.map((row) => [row.key, row]));
    return displayState.order
      .filter((key) => displayState.visible.has(key))
      .map((key) => rowByKey.get(key))
      .filter((row): row is TableRow => row != null);
  }, [displayState, allRows]);

  useEffect(() => {
    setSelectedStockName((name) => (name !== null && !filterNames.includes(name) ? null : name));
  }, [filterNames]);

  const [deleteConfirmBefore, deleteConfirmAfter] = t("deleteDialog.confirm").split("{name}");

  return (
    <main className="app-shell">
      <header className="menu-bar">
        <div className="brand">Little V</div>
        <nav aria-label={t("table.applicationMenu")}>
          <button type="button" onClick={() => setDialogOpen(true)}>{t("menu.create")}</button>
          <button type="button" onClick={openSettings}>{t("menu.settings")}</button>
          <button type="button" onClick={() => setAboutOpen(true)}>{t("menu.about")}</button>
        </nav>
      </header>

      <section className="filter-bar" aria-label={t("table.recordControls")}>
        <label className="inline-filter">
          {t("filters.names")}
          <select aria-label={t("filters.names")} value={selectedStockName ?? "all"} onChange={(event) => setSelectedStockName(event.target.value === "all" ? null : event.target.value)}>
            <option value="all">{t("filters.all")}</option>
            {filterNames.map((name) => (
              <option key={name} value={name}>{displayStockName(name)}</option>
            ))}
          </select>
        </label>
        <label className="inline-filter">
          {t("filters.status")}
          <select aria-label={t("filters.status")} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="all">{t("filters.all")}</option>
            <option value="alerted">{t("filters.statusAlerted")}</option>
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
                <NameCell row={row} />
                <td>{row.quantity ?? ""}</td>
                <PriceCell price={row.buyPrice} code={row.code} name={row.name} quantity={row.quantity} isSellPrice={false} alertClass={alerts.get(row.key)?.buy} />
                <td className={`table-date${row.buyPrice != null && !row.buyDate ? " missing-date" : ""}`} title={row.buyDate}>
                  {formatTableDate(row.buyDate, t)}
                </td>
                <PriceCell price={row.sellPrice} code={row.code} name={row.name} quantity={row.quantity} isSellPrice alertClass={alerts.get(row.key)?.sell} />
                <td className={`table-date${row.sellPrice != null && !row.sellDate ? " missing-date" : ""}`} title={row.sellDate}>
                  {formatTableDate(row.sellDate, t)}
                </td>
                <ProfitCell row={row} settings={profitSettings} />
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

      <footer className="status-bar" aria-label={t("table.statusBar")}>
        {stockSummary && (
          <span className="stock-summary">
            <span className="stock-summary-name">{displayStockName(stockSummary.name)} ({displayStockCode(stockSummary.code)})</span>
            {quotes[stockSummary.code] && (
              <span className={quoteChangeClass(quotes[stockSummary.code])}>
                {quotes[stockSummary.code].now.toFixed(pricePrecision(stockSummary.code))} / {formatQuotePercent(quotes[stockSummary.code])}
              </span>
            )}
            <span title={t("statusBar.averageCost.tooltip")}>
              {t("statusBar.averageCost")}: {stockSummary.averageCost != null ? stockSummary.averageCost.toFixed(pricePrecision(stockSummary.code)) : ""}
              {stockSummary.averageCostChangePercent != null && (
                <span className={signedChangeClass(stockSummary.averageCostChangePercent)}>
                  {" "}({formatSignedPercent(stockSummary.averageCostChangePercent)})
                </span>
              )}
            </span>
            <span title={t("statusBar.quantity.tooltip")}>{t("statusBar.quantity")}: {stockSummary.quantity}</span>
            <span title={t("statusBar.marketValue.tooltip")}>
              {t("statusBar.marketValue")}: {stockSummary.marketValue != null ? stockSummary.marketValue.toFixed(2) : ""}
            </span>
            <span
              className={stockSummary.gainLoss != null ? (stockSummary.gainLoss > 0 ? "price-gain" : stockSummary.gainLoss < 0 ? "price-loss" : "") : ""}
              title={t("statusBar.gainLoss.tooltip")}
            >
              {t("statusBar.gainLoss")}: {stockSummary.gainLoss != null ? stockSummary.gainLoss.toFixed(2) : ""}
            </span>
          </span>
        )}
        <span title={t("totalProfit.tooltip")}>{formatTotalProfit(rows, profitSettings)}</span>
      </footer>

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
        <div className="dialog-backdrop" role="presentation">
          <section className="dialog info-dialog" role="dialog" aria-label={t("settings.title")}>
            <div className="dialog-heading">
              <h2>{t("settings.title")}</h2>
              <button type="button" className="icon-button" onClick={dismissSettings} aria-label={t("dialog.close")}>
                ×
              </button>
            </div>
            <fieldset className="settings-group">
              <legend>{t("settings.general")}</legend>
              <div className="settings-grid">
                <label htmlFor="settings-language">{t("settings.language")}</label>
                <select
                  id="settings-language"
                  aria-label={t("settings.language")}
                  value={settingsDraft.languagePreference}
                  onChange={(event) => {
                    const preference = event.target.value;
                    setSettingsDraft((draft) => ({ ...draft, languagePreference: preference }));
                    if (isLanguagePreference(preference)) {
                      previewLanguagePreference(preference);
                    }
                  }}
                >
                  <option value="system">{t("settings.languageDefault")}</option>
                  <option value="en">{t("settings.languageEnglish")}</option>
                  <option value="zh_cn">{t("settings.languageZhCn")}</option>
                </select>
                <label htmlFor="settings-data-directory">{t("settings.dataDirectory")}</label>
                <div className="data-directory-input">
                  <input
                    id="settings-data-directory"
                    type="text"
                    aria-label={t("settings.dataDirectory")}
                    value={settingsDraft.dataDirectory}
                    onChange={(event) =>
                      setSettingsDraft((draft) => ({ ...draft, dataDirectory: event.target.value }))
                    }
                  />
                  <button type="button" onClick={() => void chooseDataDirectory()}>
                    {t("settings.browse")}
                  </button>
                </div>
              </div>
            </fieldset>
            <fieldset className="settings-group">
              <legend>{t("settings.prices")}</legend>
              <div className="settings-grid">
                <label htmlFor="settings-refresh-interval">{t("settings.refreshInterval")}</label>
                <input
                  id="settings-refresh-interval"
                  type="number"
                  min={MIN_REFRESH_SECONDS}
                  step={1}
                  aria-label={t("settings.refreshInterval")}
                  value={settingsDraft.refreshIntervalSeconds}
                  onChange={(event) =>
                    setSettingsDraft((draft) => ({ ...draft, refreshIntervalSeconds: event.target.value }))
                  }
                />
              </div>
            </fieldset>
            <fieldset className="settings-group">
              <legend>{t("settings.stockProfit")}</legend>
              <div className="settings-grid">
                <label htmlFor="settings-stamp-duty-rate">{t("settings.stampDutyRate")}</label>
                <input
                  id="settings-stamp-duty-rate"
                  type="number"
                  min={0}
                  step="any"
                  aria-label={t("settings.stampDutyRate")}
                  value={settingsDraft.stampDutyRatePercent}
                  onChange={(event) =>
                    setSettingsDraft((draft) => ({ ...draft, stampDutyRatePercent: event.target.value }))
                  }
                />
                <label htmlFor="settings-fee-rate">{t("settings.feeRate")}</label>
                <input
                  id="settings-fee-rate"
                  type="number"
                  min={0}
                  step="any"
                  aria-label={t("settings.feeRate")}
                  value={settingsDraft.feeRatePercent}
                  onChange={(event) => setSettingsDraft((draft) => ({ ...draft, feeRatePercent: event.target.value }))}
                />
                <label htmlFor="settings-min-fee">{t("settings.minFee")}</label>
                <input
                  id="settings-min-fee"
                  type="number"
                  min={0}
                  step="any"
                  aria-label={t("settings.minFee")}
                  value={settingsDraft.minFee}
                  onChange={(event) => setSettingsDraft((draft) => ({ ...draft, minFee: event.target.value }))}
                />
              </div>
            </fieldset>
            <fieldset className="settings-group">
              <legend>{t("settings.priceChangeAlert")}</legend>
              <div className="settings-grid">
                <label htmlFor="settings-alert-gain">{t("settings.alertGain")}</label>
                <input
                  id="settings-alert-gain"
                  type="number"
                  min={0}
                  step="any"
                  aria-label={t("settings.alertGain")}
                  value={settingsDraft.alertGainPercent}
                  onChange={(event) => setSettingsDraft((draft) => ({ ...draft, alertGainPercent: event.target.value }))}
                />
                <label htmlFor="settings-alert-loss">{t("settings.alertLoss")}</label>
                <input
                  id="settings-alert-loss"
                  type="number"
                  min={0}
                  step="any"
                  aria-label={t("settings.alertLoss")}
                  value={settingsDraft.alertLossPercent}
                  onChange={(event) => setSettingsDraft((draft) => ({ ...draft, alertLossPercent: event.target.value }))}
                />
              </div>
            </fieldset>
            {settingsError && <p className="field-error" role="alert">{settingsError}</p>}
            <div className="dialog-actions settings-actions">
              <button type="button" className="settings-default-button" onClick={() => void resetSettingsDraftToDefault()} disabled={savingSettings}>
                {t("settings.default")}
              </button>
              <button type="button" onClick={dismissSettings} disabled={savingSettings}>
                {t("dialog.cancel")}
              </button>
              <button type="button" className="primary" onClick={() => void saveSettings()} disabled={savingSettings}>
                {t("dialog.save")}
              </button>
            </div>
          </section>
        </div>
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
  const { quotes } = usePriceFeed();
  const [form, setForm] = useState(() => (editing ? formFromRow(editing) : initialForm()));
  const [stockQuery, setStockQuery] = useState(() => (editing ? `${editing.name} (${displayStockCode(editing.code)})` : ""));
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
  const selectedQuote = form.stock ? quotes[form.stock.code] : undefined;

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
    setStockQuery(`${stock.name} (${displayStockCode(stock.code)})`);
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
    if (hasBuyDate && !hasBuyPrice) {
      setError(t("dialog.buyDateRequiresPrice"));
      return;
    }
    if (hasSellDate && !hasSellPrice) {
      setError(t("dialog.sellDateRequiresPrice"));
      return;
    }
    if (!hasBuyPrice && !hasSellPrice) {
      setError(t("dialog.priceRequired"));
      return;
    }
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
          <div className={`stock-combobox${selectedQuote ? " has-current-quote" : ""}`} ref={stockComboboxRef}>
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
            {selectedQuote && (
              <output className={`stock-current-quote ${quoteChangeClass(selectedQuote)}`}>
                {selectedQuote.now.toFixed(pricePrecision(form.stock!.code))} / {formatQuotePercent(selectedQuote)}
              </output>
            )}
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
                      {stock.name} <span>({displayStockCode(stock.code)})</span>
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
