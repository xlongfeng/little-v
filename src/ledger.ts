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

const TRADE_FEE_RATE = 0.00025;
const MIN_TRADE_FEE = 5;
const STOCK_STAMP_DUTY_RATE = 0.0005;

// Net profit for a closed round-trip: buy/sell commissions are each the
// greater of a flat minimum fee or the rate-based fee, and only ordinary
// A-share stocks (not ETFs/LOFs) incur stamp duty on the sell side.
export function computeNetProfit(code: string, quantity: number, buyPrice: number, sellPrice: number): number {
  const isStock = !isEtfOrLofCode(code);
  const buyFee = buyPrice * quantity * TRADE_FEE_RATE;
  const sellFee = sellPrice * quantity * TRADE_FEE_RATE;
  const stampDutyRate = isStock ? STOCK_STAMP_DUTY_RATE : 0;
  const stampFee = sellPrice * quantity * stampDutyRate;
  const grossProfit = (sellPrice - buyPrice) * quantity;
  return grossProfit - Math.max(MIN_TRADE_FEE, buyFee) - Math.max(MIN_TRADE_FEE, sellFee) - stampFee;
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
