import { describe, expect, it } from "vitest";
import { toTableRows, type StockLedger } from "./ledger";

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
      expect.objectContaining({ key: "open-sell", buyPrice: undefined, sellPrice: 11 }),
      expect.objectContaining({ key: "closed-1", buyPrice: 10, sellPrice: 12 }),
      expect.objectContaining({ key: "open-buy", buyPrice: 8, sellPrice: undefined }),
    ]);
  });

  it("sorts rows by stock name then ascending buy date", () => {
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
  });
});
