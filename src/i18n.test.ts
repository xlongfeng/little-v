import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultLanguagePreference,
  detectSystemLanguage,
  formatRecordCount,
  isLanguage,
  isLanguagePreference,
  loadStoredLanguagePreference,
  resolveLanguage,
  storeLanguagePreference,
  translate,
} from "./i18n";

describe("detectSystemLanguage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns zh_cn for Chinese OS locales", () => {
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("zh-CN");
    expect(detectSystemLanguage()).toBe("zh_cn");
  });

  it("returns en for other OS locales", () => {
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("en-US");
    expect(detectSystemLanguage()).toBe("en");
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("fr-FR");
    expect(detectSystemLanguage()).toBe("en");
  });
});

describe("stored language preference", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to system when nothing is stored", () => {
    expect(loadStoredLanguagePreference()).toBe("system");
  });

  it("round-trips a stored language preference", () => {
    storeLanguagePreference("zh_cn");
    expect(loadStoredLanguagePreference()).toBe("zh_cn");
  });

  it("clears the stored preference when set back to system", () => {
    storeLanguagePreference("en");
    storeLanguagePreference("system");
    expect(loadStoredLanguagePreference()).toBe("system");
    expect(window.localStorage.getItem("littlev-language")).toBeNull();
  });

  it("ignores invalid stored values", () => {
    window.localStorage.setItem("littlev-language", "fr");
    expect(loadStoredLanguagePreference()).toBe("system");
  });
});

describe("resolveLanguage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves system to the OS locale", () => {
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("zh-CN");
    expect(resolveLanguage("system")).toBe("zh_cn");
  });

  it("resolves an explicit language as-is", () => {
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("zh-CN");
    expect(resolveLanguage("en")).toBe("en");
  });
});

describe("defaultLanguagePreference", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("prefers a stored override over system", () => {
    storeLanguagePreference("en");
    expect(defaultLanguagePreference()).toBe("en");
  });

  it("falls back to system when nothing is stored", () => {
    expect(defaultLanguagePreference()).toBe("system");
  });
});

describe("translate", () => {
  it("interpolates variables into the template", () => {
    expect(translate("en", "totalProfit", { value: "12.34" })).toBe("Total profit: 12.34");
    expect(translate("zh_cn", "totalProfit", { value: "12.34" })).toBe("总盈亏：12.34");
  });

  it("falls back to the raw key for an unknown translation key", () => {
    expect(translate("en", "does.not.exist")).toBe("does.not.exist");
  });
});

describe("formatRecordCount", () => {
  it("uses singular phrasing for exactly one record in English", () => {
    expect(formatRecordCount("en", 1)).toBe("1 record");
    expect(formatRecordCount("en", 0)).toBe("0 records");
    expect(formatRecordCount("en", 2)).toBe("2 records");
  });

  it("uses the same phrasing regardless of count in Chinese", () => {
    expect(formatRecordCount("zh_cn", 1)).toBe("1 条记录");
    expect(formatRecordCount("zh_cn", 2)).toBe("2 条记录");
  });
});

describe("isLanguage", () => {
  it("accepts only the supported language codes", () => {
    expect(isLanguage("en")).toBe(true);
    expect(isLanguage("zh_cn")).toBe(true);
    expect(isLanguage("fr")).toBe(false);
    expect(isLanguage(null)).toBe(false);
  });
});

describe("isLanguagePreference", () => {
  it("accepts system plus the supported language codes", () => {
    expect(isLanguagePreference("system")).toBe(true);
    expect(isLanguagePreference("en")).toBe(true);
    expect(isLanguagePreference("zh_cn")).toBe(true);
    expect(isLanguagePreference("fr")).toBe(false);
    expect(isLanguagePreference(null)).toBe(false);
  });
});
