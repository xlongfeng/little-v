import { describe, expect, it } from "vitest";
import { computeNetProfit, pricePrecision, toTableRows, type StockLedger } from "./ledger";

const ledger: StockLedger = {
  code: "SH600000",
  name: "Example Bank",
  transactions: [
    {
      uuid: "closed-1",
      createDate: "1",
      modifyDate: "1",
      quantity: 100,
      buyPrice: 10,
      buyDate: "2026-09-01",
      sellPrice: 12,
      sellDate: "2026-09-02",
    },
    {
      uuid: "open-buy",
      createDate: "2",
      modifyDate: "2",
      quantity: 20,
      buyPrice: 8,
      buyDate: "2026-09-03",
    },
    {
      uuid: "open-sell",
      createDate: "3",
      modifyDate: "3",
      quantity: 50,
      sellPrice: 11,
      sellDate: "2026-09-04",
    },
  ],
};

describe("ledger projections", () => {
  it("projects each transaction into a table row as-is", () => {
    expect(toTableRows([ledger])).toEqual([
      expect.objectContaining({ key: "open-buy", buyPrice: 8, sellPrice: undefined }),
      expect.objectContaining({ key: "closed-1", buyPrice: 10, sellPrice: 12 }),
      expect.objectContaining({ key: "open-sell", buyPrice: undefined, sellPrice: 11 }),
    ]);
  });

  it("sorts rows by stock name then ascending buy price or sell price", () => {
    const otherLedger: StockLedger = {
      code: "SZ000001",
      name: "Alpha Bank",
      transactions: [
        {
          uuid: "alpha-1",
          createDate: "1",
          modifyDate: "1",
          quantity: 10,
          buyPrice: 5,
          buyDate: "2026-01-01",
        },
      ],
    };

    const rows = toTableRows([ledger, otherLedger]);
    expect(rows[0].key).toBe("alpha-1");
    expect(rows.slice(1).map((row) => row.key)).toEqual(["open-buy", "closed-1", "open-sell"]);
  });
});

describe("pricePrecision", () => {
  it("uses 3 decimal places for Shanghai and Shenzhen ETF/LOF codes", () => {
    expect(pricePrecision("SH510300")).toBe(3);
    expect(pricePrecision("SZ159915")).toBe(3);
    expect(pricePrecision("SH560000")).toBe(3);
    expect(pricePrecision("SZ168000")).toBe(3);
  });

  it("uses 2 decimal places for ordinary A-share stock codes", () => {
    expect(pricePrecision("SH600000")).toBe(2);
    expect(pricePrecision("SZ000001")).toBe(2);
    expect(pricePrecision("SZ300001")).toBe(2);
  });
});

describe("computeNetProfit", () => {
  it("applies stamp duty and the $5 minimum commission for a stock trade", () => {
    // buyFee = 10*100*0.00025 = 0.25 -> min fee 5; sellFee = 12*100*0.00025 = 0.3 -> min fee 5
    // stampFee = 12*100*0.0005 = 0.6; gross = (12-10)*100 = 200
    // net = 200 - 5 - 5 - 0.6 = 189.4
    expect(computeNetProfit("SH600000", 100, 10, 12)).toBeCloseTo(189.4, 5);
  });

  it("charges no stamp duty for an ETF/LOF trade", () => {
    // Same figures as above but no stamp duty: net = 200 - 5 - 5 - 0 = 190
    expect(computeNetProfit("SH510300", 100, 10, 12)).toBeCloseTo(190, 5);
  });

  it("uses the rate-based fee once it exceeds the $5 minimum", () => {
    // buyFee = 30*1000*0.00025 = 7.5; sellFee = 32*1000*0.00025 = 8
    // stampFee = 32*1000*0.0005 = 16; gross = (32-30)*1000 = 2000
    // net = 2000 - 7.5 - 8 - 16 = 1968.5
    expect(computeNetProfit("SH600000", 1000, 30, 32)).toBeCloseTo(1968.5, 5);
  });
});
