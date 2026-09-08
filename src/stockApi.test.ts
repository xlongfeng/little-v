import { beforeEach, describe, expect, it, vi } from "vitest";

const searchStocks = vi.fn();

vi.mock("stock-api", () => ({
  stocks: { auto: { searchStocks } },
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
