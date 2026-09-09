export interface Transaction {
  uuid: string;
  createDate: string;
  modifyDate: string;
  quantity?: number;
  buyPrice?: number;
  buyDate?: string;
  sellPrice?: number;
  sellDate?: string;
  note?: string;
}

export interface StockLedger {
  code: string;
  name: string;
  transactions: Transaction[];
}

export interface StockOption {
  code: string;
  name: string;
}

export interface TableRow {
  key: string;
  name: string;
  code: string;
  quantity?: number;
  buyPrice?: number;
  buyDate?: string;
  sellPrice?: number;
  sellDate?: string;
  note?: string;
}

// Shanghai ETF/LOF codes use the 50/51/56/58 prefixes; Shenzhen ETF/LOF codes
// use the 15/16/18 prefixes. These funds are conventionally quoted with three
// decimal places instead of the two used for ordinary A-share stocks.
export function isEtfOrLofCode(code: string): boolean {
  return /^SH(50|51|56|58)\d+$/.test(code) || /^SZ(15|16|18)\d+$/.test(code);
}

export function pricePrecision(code: string): number {
  return isEtfOrLofCode(code) ? 3 : 2;
}

export function toTableRows(ledgers: StockLedger[]): TableRow[] {
  return ledgers
    .flatMap((ledger) =>
      ledger.transactions.map((transaction) => ({
        key: transaction.uuid,
        name: ledger.name,
        code: ledger.code,
        quantity: transaction.quantity,
        buyPrice: transaction.buyPrice,
        buyDate: transaction.buyDate,
        sellPrice: transaction.sellPrice,
        sellDate: transaction.sellDate,
        note: transaction.note,
      })),
    )
    .sort((left, right) => {
      const nameCompare = left.name.localeCompare(right.name);
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return (left.buyDate ?? "").localeCompare(right.buyDate ?? "");
    });
}
