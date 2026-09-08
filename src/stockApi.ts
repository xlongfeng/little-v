import { stocks } from "stock-api";
import type { StockOption } from "./ledger";

// Normalized A-share codes look like SH600000 / SZ000001. Only keep
// mainboard/ChiNext/STAR-market stocks, ETFs, and LOFs, and exclude index
// codes (e.g. SH000300, SZ399006) and non A-share markets (e.g. HK/US codes).
const A_SHARE_CODE_PATTERNS = [
  /^SH6\d+$/, // Shanghai main board / STAR market stocks
  /^SH(50|51|56|58)\d+$/, // Shanghai ETFs and LOFs
  /^SZ(000|001|002|003|300|301)\d+$/, // Shenzhen main board / ChiNext stocks
  /^SZ(15|16|18)\d+$/, // Shenzhen ETFs and LOFs
];

function isAStockOrEtf(code: string): boolean {
  return A_SHARE_CODE_PATTERNS.some((pattern) => pattern.test(code));
}

export async function searchStocks(query: string): Promise<StockOption[]> {
  if (!query.trim()) {
    return [];
  }

  const results = await stocks.auto.searchStocks(query.trim());
  return results
    .filter((stock) => isAStockOrEtf(stock.code))
    .map((stock) => ({
      code: stock.code,
      name: stock.name,
    }));
}
