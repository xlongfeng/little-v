import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { fetchQuotes, type StockQuote } from "./stockApi";

const REFRESH_STORAGE_KEY = "littlev-price-refresh-seconds";
const STOCK_QUOTES_UPDATED_EVENT = "stock-quotes-updated";
export const DEFAULT_REFRESH_SECONDS = 3;
export const MIN_REFRESH_SECONDS = 1;

export function loadStoredRefreshSeconds(): number {
  const stored = window.localStorage.getItem(REFRESH_STORAGE_KEY);
  const parsed = stored != null ? Number(stored) : NaN;
  return Number.isFinite(parsed) && parsed >= MIN_REFRESH_SECONDS ? parsed : DEFAULT_REFRESH_SECONDS;
}

interface PriceFeedContextValue {
  quotes: Record<string, StockQuote>;
  refreshIntervalSeconds: number;
  setRefreshIntervalSeconds: (seconds: number) => void;
  setCodes: (source: string, codes: string[]) => void;
}

const PriceFeedContext = createContext<PriceFeedContextValue | null>(null);

export function PriceFeedProvider({ children, coordinator = true }: { children: ReactNode; coordinator?: boolean }) {
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [refreshIntervalSeconds, setRefreshIntervalSecondsState] = useState<number>(loadStoredRefreshSeconds);
  const [codeSources, setCodeSources] = useState<Record<string, string[]>>({});
  const codes = useMemo(() => [...new Set(Object.values(codeSources).flat())], [codeSources]);
  const codesRef = useRef<string[]>([]);
  codesRef.current = codes;

  const setCodes = useCallback((source: string, nextCodes: string[]) => {
    setCodeSources((current) => ({ ...current, [source]: nextCodes }));
  }, []);

  function setRefreshIntervalSeconds(seconds: number) {
    const clamped = Number.isFinite(seconds) && seconds >= MIN_REFRESH_SECONDS ? seconds : DEFAULT_REFRESH_SECONDS;
    setRefreshIntervalSecondsState(clamped);
    window.localStorage.setItem(REFRESH_STORAGE_KEY, String(clamped));
  }

  useEffect(() => {
    let stopListening: (() => void) | undefined;
    void invoke<Record<string, StockQuote>>("get_cached_stock_quotes")
      .then((cached) => {
        if (cached && typeof cached === "object" && !Array.isArray(cached)) {
          setQuotes(cached);
        }
      })
      .catch(() => undefined);
    void listen<Record<string, StockQuote>>(STOCK_QUOTES_UPDATED_EVENT, (event) => {
      setQuotes(event.payload);
    }).then((stop) => {
      stopListening = stop;
    });
    return () => stopListening?.();
  }, []);

  useEffect(() => {
    if (!coordinator) {
      return;
    }
    let cancelled = false;
    let timer: number | null = null;

    function scheduleNext() {
      if (!cancelled) {
        timer = window.setTimeout(poll, refreshIntervalSeconds * 1000);
      }
    }

    async function poll() {
      if (codesRef.current.length) {
        try {
          const latest = await fetchQuotes(codesRef.current);
          if (!cancelled) {
            setQuotes((previous) => ({ ...previous, ...latest }));
            await invoke("cache_stock_quotes", { quotes: latest });
          }
        } catch {
          // Ignore transient failures; keep showing the last known quotes.
        }
      }
      scheduleNext();
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [coordinator, refreshIntervalSeconds, codes]);

  const value = useMemo<PriceFeedContextValue>(
    () => ({ quotes, refreshIntervalSeconds, setRefreshIntervalSeconds, setCodes }),
    [quotes, refreshIntervalSeconds],
  );

  return <PriceFeedContext.Provider value={value}>{children}</PriceFeedContext.Provider>;
}

export function usePriceFeed(): PriceFeedContextValue {
  const context = useContext(PriceFeedContext);
  if (!context) {
    throw new Error("usePriceFeed must be used within a PriceFeedProvider");
  }
  return context;
}
