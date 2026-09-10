import { ReactNode, useState } from "react";
import {
  defaultLanguagePreference,
  LanguageContext,
  resolveLanguage,
  storeLanguagePreference,
  translate,
  type LanguagePreference,
} from "./i18n";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [languagePreference, setLanguagePreferenceState] = useState<LanguagePreference>(defaultLanguagePreference);
  const language = resolveLanguage(languagePreference);

  function setLanguagePreference(next: LanguagePreference) {
    setLanguagePreferenceState(next);
    storeLanguagePreference(next);
  }

  function t(key: string, vars?: Record<string, string | number>): string {
    return translate(language, key, vars);
  }

  return (
    <LanguageContext.Provider value={{ language, languagePreference, setLanguagePreference, t }}>
      {children}
    </LanguageContext.Provider>
  );
}
