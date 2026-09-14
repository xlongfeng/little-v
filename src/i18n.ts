import { createContext, useContext } from "react";

export type Language = "en" | "zh_cn";

const STORAGE_KEY = "littlev-language";

type Dictionary = Record<string, string>;

const en: Dictionary = {
  "menu.create": "Create",
  "menu.settings": "Settings",
  "menu.about": "About",
  "totalProfit": "{value}",
  "totalProfit.tooltip": "Total profit",
  "filters.names": "Names",
  "filters.all": "All",
  "filters.status": "Status",
  "filters.statusAlerted": "Alerted only",
  "filters.statusOpen": "Open only",
  "filters.statusClosed": "Closed only",
  "filters.period": "Period",
  "filters.period6m": "Last 6 months",
  "filters.period1y": "Last year",
  "filters.period2y": "Last 2 years",
  "filters.recordCount_one": "{count} record",
  "filters.recordCount_other": "{count} records",
  "loadError": "Could not load records: {error}",
  "table.name": "Name",
  "table.quantity": "Quantity",
  "table.buyPrice": "Buy Price",
  "table.buyDate": "Buy Date",
  "table.sellPrice": "Sell Price",
  "table.sellDate": "Sell Date",
  "table.dateToday": "today",
  "table.dateDayAgo": "1 day ago",
  "table.dateTwoDaysAgo": "2 days ago",
  "table.dateThreeDaysAgo": "3 days ago",
  "table.dateWeekAgo": "1 week ago",
  "table.dateTwoWeeksAgo": "2 weeks ago",
  "table.dateMonthAgo": "1 month ago",
  "table.dateTwoMonthsAgo": "2 months ago",
  "table.dateThreeMonthsAgo": "3 months ago",
  "table.dateSixMonthsAgo": "6 months ago",
  "table.dateYearAgo": "1 year ago",
  "table.profit": "Profit",
  "table.actions": "Actions",
  "table.note": "Note: {note}",
  "table.deleteTransaction": "Delete transaction",
  "table.noRecords": "No trading records yet. Use Create to add one.",
  "table.recordControls": "Record controls",
  "table.tradingRecords": "Trading records",
  "table.applicationMenu": "Application menu",
  "table.statusBar": "Status bar",
  "dialog.createTransaction": "Create transaction",
  "dialog.editTransaction": "Edit transaction",
  "dialog.close": "Close",
  "dialog.stock": "Stock",
  "dialog.stockPlaceholder": "Select or search a stock",
  "dialog.showExistingStocks": "Show existing stocks",
  "dialog.noMatchingStocks": "No matching stocks found.",
  "dialog.quantity": "Quantity",
  "dialog.buyPrice": "Buy price",
  "dialog.buyDate": "Buy date",
  "dialog.sellPrice": "Sell price",
  "dialog.sellDate": "Sell date",
  "dialog.note": "Note",
  "dialog.cancel": "Cancel",
  "dialog.save": "Save",
  "dialog.saving": "Saving…",
  "dialog.selectStock": "Select a stock.",
  "dialog.quantityPositive": "Quantity must be greater than zero.",
  "dialog.quantityWholeNumber": "Quantity must be a whole number.",
  "dialog.quantityMultiple100": "Quantity must be a multiple of 100.",
  "dialog.priceRequired": "Enter a buy price or sell price.",
  "dialog.buyDateRequiresPrice": "Enter a buy price when a buy date is set.",
  "dialog.sellDateRequiresPrice": "Enter a sell price when a sell date is set.",
  "dialog.stockSearchUnavailable": "Stock search is unavailable: {error}",
  "deleteDialog.title": "Delete transaction",
  "deleteDialog.confirm": "Are you sure you want to delete this transaction for {name}? This cannot be undone.",
  "deleteDialog.error": "Could not delete transaction: {error}",
  "deleteDialog.cancel": "Cancel",
  "deleteDialog.delete": "Delete",
  "deleteDialog.deleting": "Deleting…",
  "about.title": "About Little V",
  "about.version": "Version {version}",
  "about.description": "A local stock transaction ledger.",
  "settings.title": "Settings",
  "settings.general": "General",
  "settings.dataDirectory": "Data folder",
  "settings.browse": "Browse...",
  "settings.selectDataDirectory": "Select data folder",
  "settings.invalidValues": "Enter valid settings before saving.",
  "settings.language": "Language",
  "settings.languageDefault": "System Default",
  "settings.languageEnglish": "English",
  "settings.languageZhCn": "简体中文",
  "settings.prices": "Stock Quotes",
  "settings.refreshInterval": "Refresh interval (seconds)",
  "settings.stockProfit": "Stock Fee",
  "settings.feeRate": "Trade fee rate (%)",
  "settings.minFee": "Minimum trade fee",
  "settings.stampDutyRate": "Stamp duty rate (%)",
  "settings.priceChangeAlert": "Price Change Alert",
  "settings.alertGain": "Gain (%)",
  "settings.alertLoss": "Loss (%)",
  "settings.default": "Default",
};

const zh_cn: Dictionary = {
  "menu.create": "新建",
  "menu.settings": "设置",
  "menu.about": "关于",
  "totalProfit": "{value}",
  "totalProfit.tooltip": "总利润",
  "filters.names": "名称",
  "filters.all": "全部",
  "filters.status": "状态",
  "filters.statusAlerted": "仅预警",
  "filters.statusOpen": "仅持仓中",
  "filters.statusClosed": "仅已平仓",
  "filters.period": "期间",
  "filters.period6m": "最近6个月",
  "filters.period1y": "最近1年",
  "filters.period2y": "最近2年",
  "filters.recordCount_one": "{count} 条记录",
  "filters.recordCount_other": "{count} 条记录",
  "loadError": "无法加载记录：{error}",
  "table.name": "名称",
  "table.quantity": "数量",
  "table.buyPrice": "买入价",
  "table.buyDate": "买入日期",
  "table.sellPrice": "卖出价",
  "table.sellDate": "卖出日期",
  "table.dateToday": "今天",
  "table.dateDayAgo": "1天前",
  "table.dateTwoDaysAgo": "2天前",
  "table.dateThreeDaysAgo": "3天前",
  "table.dateWeekAgo": "1周前",
  "table.dateTwoWeeksAgo": "2周前",
  "table.dateMonthAgo": "1月前",
  "table.dateTwoMonthsAgo": "2月前",
  "table.dateThreeMonthsAgo": "3月前",
  "table.dateSixMonthsAgo": "6月前",
  "table.dateYearAgo": "1年前",
  "table.profit": "盈亏",
  "table.actions": "操作",
  "table.note": "备注：{note}",
  "table.deleteTransaction": "删除交易",
  "table.noRecords": "暂无交易记录，点击“新建”添加一条。",
  "table.recordControls": "记录筛选控件",
  "table.tradingRecords": "交易记录",
  "table.applicationMenu": "应用菜单",
  "table.statusBar": "状态栏",
  "dialog.createTransaction": "新建交易",
  "dialog.editTransaction": "编辑交易",
  "dialog.close": "关闭",
  "dialog.stock": "股票",
  "dialog.stockPlaceholder": "选择或搜索股票",
  "dialog.showExistingStocks": "显示已记录股票",
  "dialog.noMatchingStocks": "未找到匹配的股票。",
  "dialog.quantity": "数量",
  "dialog.buyPrice": "买入价",
  "dialog.buyDate": "买入日期",
  "dialog.sellPrice": "卖出价",
  "dialog.sellDate": "卖出日期",
  "dialog.note": "备注",
  "dialog.cancel": "取消",
  "dialog.save": "保存",
  "dialog.saving": "保存中…",
  "dialog.selectStock": "请选择一支股票。",
  "dialog.quantityPositive": "数量必须大于零。",
  "dialog.quantityWholeNumber": "数量必须是整数。",
  "dialog.quantityMultiple100": "数量必须是100的整数倍。",
  "dialog.priceRequired": "请输入买入价或卖出价。",
  "dialog.buyDateRequiresPrice": "填写买入日期时请输入买入价。",
  "dialog.sellDateRequiresPrice": "填写卖出日期时请输入卖出价。",
  "dialog.stockSearchUnavailable": "股票搜索不可用：{error}",
  "deleteDialog.title": "删除交易",
  "deleteDialog.confirm": "确定要删除 {name} 的这条交易记录吗？此操作无法撤销。",
  "deleteDialog.error": "无法删除交易：{error}",
  "deleteDialog.cancel": "取消",
  "deleteDialog.delete": "删除",
  "deleteDialog.deleting": "删除中…",
  "about.title": "关于 Little V",
  "about.version": "版本 {version}",
  "about.description": "本地股票交易记录应用。",
  "settings.title": "设置",
  "settings.general": "常规",
  "settings.dataDirectory": "数据文件夹",
  "settings.browse": "浏览...",
  "settings.selectDataDirectory": "选择数据文件夹",
  "settings.invalidValues": "请输入有效的设置后再保存。",
  "settings.language": "语言",
  "settings.languageDefault": "系统默认",
  "settings.languageEnglish": "English",
  "settings.languageZhCn": "简体中文",
  "settings.prices": "股票行情",
  "settings.refreshInterval": "刷新间隔（秒）",
  "settings.stockProfit": "股票手续费",
  "settings.feeRate": "交易手续费率（%）",
  "settings.minFee": "最低交易手续费",
  "settings.stampDutyRate": "印花税率（%）",
  "settings.priceChangeAlert": "涨跌幅预警",
  "settings.alertGain": "涨幅（%）",
  "settings.alertLoss": "跌幅（%）",
  "settings.default": "默认",
};

const translations: Record<Language, Dictionary> = { en, zh_cn };

export function isLanguage(value: string | null): value is Language {
  return value === "en" || value === "zh_cn";
}

export type LanguagePreference = "system" | Language;

export function isLanguagePreference(value: string | null): value is LanguagePreference {
  return value === "system" || isLanguage(value);
}

export function detectSystemLanguage(): Language {
  const locale = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en";
  return locale.toLowerCase().startsWith("zh") ? "zh_cn" : "en";
}

export function loadStoredLanguagePreference(): LanguagePreference {
  if (typeof window === "undefined") {
    return "system";
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isLanguagePreference(stored) ? stored : "system";
}

export function storeLanguagePreference(preference: LanguagePreference): void {
  if (typeof window === "undefined") {
    return;
  }
  if (preference === "system") {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, preference);
  }
}

export function resolveLanguage(preference: LanguagePreference): Language {
  return preference === "system" ? detectSystemLanguage() : preference;
}

export function defaultLanguagePreference(): LanguagePreference {
  return loadStoredLanguagePreference();
}

export function translate(language: Language, key: string, vars?: Record<string, string | number>): string {
  let template = translations[language][key] ?? translations.en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      template = template.split(`{${name}}`).join(String(value));
    }
  }
  return template;
}

export function formatRecordCount(language: Language, count: number): string {
  const key = count === 1 ? "filters.recordCount_one" : "filters.recordCount_other";
  return translate(language, key, { count });
}

export interface LanguageContextValue {
  language: Language;
  languagePreference: LanguagePreference;
  setLanguagePreference: (preference: LanguagePreference) => void;
  previewLanguagePreference: (preference: LanguagePreference) => void;
  clearLanguagePreview: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export const LanguageContext = createContext<LanguageContextValue | null>(null);

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
