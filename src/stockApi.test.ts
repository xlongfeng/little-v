import { beforeEach, describe, expect, it, vi } from "vitest";

const searchStocks = vi.fn();
const getStocks = vi.fn();

vi.mock("stock-api", () => ({
  stocks: { auto: { searchStocks, getStocks } },
}));

describe("searchStocks", () => {
  beforeEach(() => {
    searchStocks.mockReset();
  });

  it("returns only A-share stocks, ETFs, and LOFs, excluding indices and other markets", async () => {
    const { searchStocks: search } = await import("./stockApi");
    searchStocks.mockResolvedValue([
      { code: "SH600000", name: "浦发银行" }, // stock
      { code: "SZ000001", name: "平安银行" }, // stock
      { code: "SZ300750", name: "宁德时代" }, // stock
      { code: "SH510500", name: "中证500ETF" }, // ETF
      { code: "SZ159915", name: "创业板ETF" }, // ETF
      { code: "SH501018", name: "南方原油LOF" }, // LOF
      { code: "SZ161725", name: "招商中证白酒LOF" }, // LOF
      { code: "SH000300", name: "沪深300" }, // index, excluded
      { code: "SZ399006", name: "创业板指" }, // index, excluded
      { code: "HK02020", name: "安踏体育" }, // non A-share, excluded
      { code: "USDJI", name: "道琼斯指数" }, // non A-share, excluded
    ]);

    const result = await search("test");

    expect(result).toEqual([
      { code: "SH600000", name: "浦发银行" },
      { code: "SZ000001", name: "平安银行" },
      { code: "SZ300750", name: "宁德时代" },
      { code: "SH510500", name: "中证500ETF" },
      { code: "SZ159915", name: "创业板ETF" },
      { code: "SH501018", name: "南方原油LOF" },
      { code: "SZ161725", name: "招商中证白酒LOF" },
    ]);
  });

  it("returns an empty array for a blank query", async () => {
    const { searchStocks: search } = await import("./stockApi");
    expect(await search("  ")).toEqual([]);
    expect(searchStocks).not.toHaveBeenCalled();
  });
});

describe("fetchQuotes", () => {
  beforeEach(() => {
    getStocks.mockReset();
  });

  it("returns a map of quotes keyed by code, deduplicating requested codes", async () => {
    const { fetchQuotes } = await import("./stockApi");
    getStocks.mockResolvedValue([
      { code: "SH600000", name: "浦发银行", now: 10.5, low: 10, high: 11, percent: 0.05, yesterday: 10 },
      { code: "SZ000001", name: "平安银行", now: 9.5, low: 9, high: 10, percent: -0.05, yesterday: 10 },
    ]);

    const result = await fetchQuotes(["SH600000", "SZ000001", "SH600000"]);

    expect(getStocks).toHaveBeenCalledWith(["SH600000", "SZ000001"]);
    expect(result).toEqual({
      SH600000: { code: "SH600000", now: 10.5, yesterday: 10, percent: 0.05 },
      SZ000001: { code: "SZ000001", now: 9.5, yesterday: 10, percent: -0.05 },
    });
  });

  it("returns an empty map without calling the API for an empty code list", async () => {
    const { fetchQuotes } = await import("./stockApi");
    expect(await fetchQuotes([])).toEqual({});
    expect(getStocks).not.toHaveBeenCalled();
  });
});
