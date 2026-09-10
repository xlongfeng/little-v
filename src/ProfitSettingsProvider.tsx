import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import { DEFAULT_PROFIT_SETTINGS, type ProfitSettings } from "./ledger";

const STORAGE_KEY = "littlev-profit-settings";

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isProfitSettings(value: unknown): value is ProfitSettings {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isFiniteNonNegative(candidate.feeRate) &&
    isFiniteNonNegative(candidate.minFee) &&
    isFiniteNonNegative(candidate.stampDutyRate)
  );
}

export function loadStoredProfitSettings(): ProfitSettings {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return DEFAULT_PROFIT_SETTINGS;
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    return isProfitSettings(parsed) ? parsed : DEFAULT_PROFIT_SETTINGS;
  } catch {
    return DEFAULT_PROFIT_SETTINGS;
  }
}

export function storeProfitSettings(settings: ProfitSettings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

interface ProfitSettingsContextValue {
  profitSettings: ProfitSettings;
  setProfitSettings: (settings: ProfitSettings) => void;
}

const ProfitSettingsContext = createContext<ProfitSettingsContextValue | null>(null);

export function ProfitSettingsProvider({ children }: { children: ReactNode }) {
  const [profitSettings, setProfitSettingsState] = useState<ProfitSettings>(loadStoredProfitSettings);

  function setProfitSettings(settings: ProfitSettings) {
    setProfitSettingsState(settings);
    storeProfitSettings(settings);
  }

  const value = useMemo<ProfitSettingsContextValue>(
    () => ({ profitSettings, setProfitSettings }),
    [profitSettings],
  );

  return <ProfitSettingsContext.Provider value={value}>{children}</ProfitSettingsContext.Provider>;
}

export function useProfitSettings(): ProfitSettingsContextValue {
  const context = useContext(ProfitSettingsContext);
  if (!context) {
    throw new Error("useProfitSettings must be used within a ProfitSettingsProvider");
  }
  return context;
}
