import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { fetchQuotes, type StockQuote } from "./stockApi";

const REFRESH_STORAGE_KEY = "littlev-price-refresh-seconds";
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
  setCodes: (codes: string[]) => void;
}

const PriceFeedContext = createContext<PriceFeedContextValue | null>(null);

export function PriceFeedProvider({ children }: { children: ReactNode }) {
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [refreshIntervalSeconds, setRefreshIntervalSecondsState] = useState<number>(loadStoredRefreshSeconds);
  const [codes, setCodes] = useState<string[]>([]);
  const codesRef = useRef<string[]>([]);
  codesRef.current = codes;

  function setRefreshIntervalSeconds(seconds: number) {
    const clamped = Number.isFinite(seconds) && seconds >= MIN_REFRESH_SECONDS ? seconds : DEFAULT_REFRESH_SECONDS;
    setRefreshIntervalSecondsState(clamped);
    window.localStorage.setItem(REFRESH_STORAGE_KEY, String(clamped));
  }

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    function scheduleNext() {
      if (!cancelled) {
        timer = window.setTimeout(poll, refreshIntervalSeconds * 1000);
      }
    }

    async function poll() {
      // Skip the network call while the window is not visible (e.g.
      // minimized or on another virtual desktop), but keep the loop
      // running so it resumes on its own schedule if visibility isn't
      // restored through the event listener below.
      if (codesRef.current.length && !document.hidden) {
        try {
          const latest = await fetchQuotes(codesRef.current);
          if (!cancelled) {
            setQuotes((previous) => ({ ...previous, ...latest }));
          }
        } catch {
          // Ignore transient failures; keep showing the last known quotes.
        }
      }
      scheduleNext();
    }

    function handleVisibilityChange() {
      if (!document.hidden) {
        // Refresh immediately once the window becomes visible again
        // instead of waiting out the remainder of the interval.
        if (timer != null) {
          window.clearTimeout(timer);
        }
        void poll();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void poll();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [refreshIntervalSeconds, codes]);

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
