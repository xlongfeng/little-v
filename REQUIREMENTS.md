# Little V

## Product Requirements

**Little V** is a desktop application for recording and reviewing stock trades. It is a local ledger designed to make completed and open investment lots easy to inspect.

## 1. Product Goals

- Record stock buys and sells accurately in a durable local ledger.
- Present each buy lot and its corresponding sell, when closed, in a compact spreadsheet-like view.
- Make new transactions quick to enter with stock lookup and clear validation.
- Keep the first release simple, private, and offline-first.

## 2. First-Release Scope

| Area | Included |
| --- | --- |
| Platform | Tauri desktop application with a React and TypeScript interface |
| Storage | Local JSON stock ledgers in a configurable user folder; application preferences and the selected folder are kept in browser `localStorage` |
| Transactions | Create and delete buy and sell transactions |
| Stock selection | A unified combobox for existing stocks and search through [`stock-api`](https://github.com/zhangxiangliang/stock-api) |
| Ledger behavior | Transactions can be created, edited (double-click a row), and deleted (via a delete icon at the end of each row) |
| Lot shape | Each transaction directly carries its own optional buy price/date and sell price/date |

The first release does **not** include partial lot closing, portfolio performance calculations, or cloud synchronization.

## 3. Technology

- **Desktop runtime:** Tauri
- **Frontend:** React and TypeScript
- **Frontend tests:** Vitest and React Testing Library
- **Backend tests:** Rust `cargo test`

## 4. Local Ledger Storage

### 4.1 Location and files

- Ledger files are stored under a `stocks` folder in the configured data folder, which defaults to `Documents\Little V` for the current user.
- Each file represents one stock and is named `<stock-code>.json`.
- A stock code may contain letters, numbers, hyphens, and underscores.
- Saving a transaction updates only that stock's ledger file.
- Deleting the final transaction in a ledger also deletes that ledger's stock file.
- Changes to stock files made outside Little V are detected automatically and reload the table.

### 4.2 JSON structure

Each stock file contains the stock identity and its transactions:

```json
{
  "code": "SH600000",
  "name": "Example Bank",
  "transactions": []
}
```

The stock `name` and `code` are stored once per file, not repeated on each transaction. Each transaction stores:

| Field | Description |
| --- | --- |
| `uuid` | Automatically generated unique transaction ID |
| `createDate` | Automatically generated creation timestamp |
| `modifyDate` | Automatically generated last-modified timestamp |
| `quantity` | Optional trade quantity, stored as an integer (no fractional part); when present, must be a positive whole number that is a multiple of 100 |
| `buyPrice` | Optional buy price; must be a positive number when present; at least one of `buyPrice` or `sellPrice` is required |
| `buyDate` | Optional buy date in `YYYY-MM-DD` format when present; requires `buyPrice` |
| `sellPrice` | Optional sell price; must be a positive number when present; at least one of `buyPrice` or `sellPrice` is required |
| `sellDate` | Optional sell date in `YYYY-MM-DD` format when present; requires `sellPrice` |
| `note` | Optional free-text note (single-line or multi-line); leading/trailing whitespace is trimmed and blank notes are treated as absent |

## 5. Transaction Rules

### 5.1 Buy and sell sides

- Each transaction directly records its own buy side (price and date) and/or sell side (price and date); there is no linking between separate transaction records.
- A transaction with only a buy side represents an open long lot.
- A transaction with only a sell side represents an open short lot.
- A transaction with both a buy side and a sell side represents a single, already-closed round-trip entered in one step.
- The stock is the only required field; quantity, buy price, buy date, sell price, and sell date are all independently optional and may be left empty in any combination — a price does not require its matching date, and vice versa.

### 5.2 Data integrity

- Stock name and code are required; every other field is optional.
- Quantity, when provided, must be a finite positive whole number that is a multiple of 100.
- Each price, when present, must be a finite positive value; each date, when present, must use `YYYY-MM-DD` and requires the price on the same side. A transaction must contain a Buy Price, Sell Price, or both.
- Prices are rounded before being saved: ordinary A-share stocks are stored with 2 decimal places, while ETFs and LOFs are stored with 3 decimal places.
- Transactions can be edited in place by double-clicking their row, or removed entirely via the trading record table's row **Delete transaction** icon.

## 6. User Interface

The interface uses a clean, Excel-inspired layout with a light ribbon-style application menu, a compact filter strip, and a high-density data table.

### 6.1 Menu bar

| Menu item | Behavior |
| --- | --- |
| **Create** | Opens the transaction creation dialog |
| **Merge** | Opens the Merge transactions dialog (see §7) |
| **Settings** | Shows **General** (Language and data folder), **Stock Quotes** (refresh interval), **Stock Fee** (stamp duty rate, trade fee rate, minimum trade fee), and **Price Change Alert** (Gain and Loss thresholds) groups. All changes are staged in the dialog and only take effect after **Save**; the dialog also offers **Default** (resets the in-progress draft to the built-in defaults, without applying it) and **Cancel** (closes the dialog and discards any unsaved changes) |
| **About** | Shows the dialog title **About Little V** followed by the app version (**Version `X.Y.Z`**) in a smaller font, and a short application description |

At the far right of the Filters bar, the count of currently visible rows (i.e. after applying the Filters) is shown, such as `0 records`.

A status bar at the bottom of the window shows the sum of Profit for currently visible rows (see §6.3 for the formula), right-aligned. Hovering the profit value shows a **Total profit** tooltip.

When a single stock is selected in the Names filter, the status bar also shows, at its left edge, a summary for that stock built only from its **valid open transactions** (an open Buy needs quantity, Buy Price, and Buy Date; an open Sell needs quantity, Sell Price, and Sell Date; a transaction with both a buy and sell side, or missing its price/date, does not count): the stock's display name and code (with its leading market-prefix letters omitted for display), its live current price and percentage change (when a quote is available, colored red for a gain and green for a loss), the average cost per share across open buys (**Avg cost**, `Σ (buy price × quantity) / Σ quantity` over open buys only), shown with the current gain/loss percentage against that average cost in parentheses (`(current price − average cost) / average cost`, colored red for a gain and green for a loss), the net open quantity (**Qty**, total open Buy quantity minus total open Sell quantity — negative when net short), the total current market value of that net quantity at the live price (**Value**, `quantity × current price`), and the total current gain or loss across the open position (**P/L**: `Σ (current price − buy price) × quantity` for open buys, plus `Σ (sell price − current price) × quantity` for open sells; colored red for a gain and green for a loss). This summary always reflects the selected stock's full position regardless of the Status/Period filters.

### 6.1.1 Language / localization

- The app supports **English** and **Simplified Chinese** (`zh_cn`).
- On first launch, the language preference is **Default**, which follows the OS/browser language (`navigator.language`): any locale starting with `zh` resolves to Simplified Chinese, everything else resolves to English.
- The **Settings** dialog's **Language** dropdown offers **System Default**, **English**, and **简体中文**. Choosing an option immediately previews that language throughout the interface, including the dialog itself, without persisting the change. The choice becomes the applied language only after clicking **Save** (see §6.1.3). Choosing English or Chinese explicitly overrides the OS language, while choosing System Default clears the override and resumes following the OS language.
- An explicit language choice is persisted in browser `localStorage` (`littlev-language`) and takes precedence over the OS default on subsequent launches; selecting Default and saving removes the stored override.

### 6.1.2 Live price refresh

- A background task periodically fetches the current market quote (current price, previous close, and change rate) for every stock code present in the ledger, independent of the active Names/Status/Period filters.
- The refresh interval defaults to **3 seconds** and is configurable in **Settings → Stock Quotes → Refresh interval (seconds)** (minimum 1 second); the chosen value takes effect after **Save** and is persisted in browser `localStorage` (`littlev-price-refresh-seconds`).
- Polling is skipped while the application window is not visible (e.g. minimized) and resumes immediately, refreshing right away, once the window becomes visible again.
- A quote that fails to load (e.g. a transient network error) leaves the previously fetched quote in place rather than clearing it or interrupting the polling loop.
- The latest quotes are held in memory only and are not persisted to disk.

### 6.1.3 Settings dialog editing model

- The Settings dialog stages every field (Language, data folder, Refresh interval, Stock Fee fields, and Price Change Alert fields) in a local draft; opening the dialog initializes the draft from the currently applied values. Language selection is the exception in presentation only: it immediately previews the selected language, without applying or persisting it.
- **Save** validates and applies the entire draft at once (data folder, Language, Refresh interval, Stock Fee settings, and Price Change Alert settings together). Every applied setting is persisted in browser `localStorage`.
- **Default** resets only the in-progress draft to the built-in defaults (System Default language, 3-second refresh interval, and the default Stock Fee and Price Change Alert values below); it does **not** apply or persist anything until **Save** is subsequently clicked.
- **Cancel** (and the dialog's close button) discards the draft, restores the previously applied language if it was being previewed, and closes the dialog without applying or persisting any changes; the next time Settings is opened, the draft is rebuilt from the still-current applied values.
- Save rejects the draft when the data folder is blank or unavailable, the refresh interval is below one second, or a Stock Fee field is not a finite, non-negative number; no draft values are applied in that case.

### 6.1.4 Storage

- The application data folder defaults to **`Documents\Little V`** for the current user.
- The **Settings → Storage → Data folder** control accepts an absolute existing directory and provides a native **Browse** picker. The selected directory takes effect after **Save**.
- The chosen folder contains only stock data: the stock ledger directory, **`stocks\`**, whose files are named **`<stock-code>.json`**.
- The selected data folder is persisted in browser `localStorage` as `littlev-stock-data-directory`. Language, refresh interval, and Stock Fee values use their own `localStorage` keys, so no application setting is stored with the stock data folder.
- Choosing a different data folder switches to that folder's ledger collection. It does not move or merge data from the previous folder.
- Little V monitors the selected `stocks\` directory. When stock JSON files are added, modified, renamed, or deleted outside the application, it automatically reloads the table from disk.

### 6.1.5 Stock Fee settings

- The **Stock Fee** group in Settings makes the net-profit formula's constants (see §6.3) configurable:

| Field | Default | Notes |
| --- | --- | --- |
| Stamp duty rate (%) | `0.05` | Percentage; stored internally as a decimal (`0.0005`); applies to the sell side of ordinary stocks only |
| Trade fee rate (%) | `0.025` | Percentage; stored internally as a decimal (`0.00025`) |
| Minimum trade fee | `5` | Flat currency amount per side |

- Changed values apply to the Profit column and the status bar's profit summary immediately after **Save**, and are persisted in browser `localStorage` (`littlev-profit-settings`).

### 6.1.6 Price Change Alert settings

- The **Price Change Alert / 涨跌幅预警** group in Settings provides configurable **Gain (%)** and **Loss (%)** thresholds, both defaulting to `3`.
- These values are persisted in browser `localStorage` (`littlev-price-alert-settings`) and are applied to open transactions only when a live quote is available.
- Each price side is evaluated independently per stock:

| Candidate | Selection | Alert condition | Color |
| --- | --- | --- | --- |
| Dated Buy | Lowest open Buy Price with a Buy Date | Current price `< buy price × (1 − Loss%)` | Green |
| Dated Buy | Lowest open Buy Price with a Buy Date | Current price `> buy price × (1 + Gain%)` | Red |
| Undated Buy | Lowest open Buy Price with no Buy Date | Current price `< buy price` | Green |
| Dated Sell | Highest open Sell Price with a Sell Date | Current price `< sell price × (1 − Loss%)` | Red |
| Undated Sell | Highest open Sell Price with no Sell Date | Current price `> sell price` | Red |

### 6.2 Filters

- Appears directly below the menu bar as a **Filters** toolbar.
- **Names**: a dropdown to show **All** or a single stock name (each entry shown with its first `ETF` or `LOF` substring and all following text omitted, matching the table's Name display); selecting a stock name shows only that stock's rows, generated from the loaded ledger rows.
- **Status**: a dropdown to show **All**, **Alerted only** (currently showing a Price Change Alert color on its buy or sell price cell; see §6.1.6), **Open only** (missing quantity, a buy price/date, or a sell price/date), or **Closed only** (has quantity, buy price, buy date, sell price, and sell date all present).
- **Period**: a dropdown to show **All**, **Last 6 months**, **Last year**, or **Last 2 years**, based on the most recent of a row's buy date and sell date. Rows with neither a buy date nor a sell date are always included, regardless of the selected period.
- All three filters combine (AND) to determine the visible rows.
- Displays the number of matching records.
- Once a row is shown under the active filters, editing it does not remove it from view even if the edit makes it stop matching; it stays pinned until a filter dropdown is changed (any selection change), at which point the filters are re-applied from scratch. Deleting a row always removes it immediately, regardless of filters.

### 6.3 Trading record table

- Shows one row per transaction.
- A transaction with only a buy side shows empty sell values; one with only a sell side shows empty buy values.
- Rows are sorted by stock name, then ascending Buy Price; rows without a Buy Price use their Sell Price instead, and rows without either price sort first within their name. This sort order determines only where a newly created row is inserted; editing an existing row never moves it from its current on-screen position, even if the edit changes values the sort is based on. Changing any Filters selection re-applies the sort order and re-evaluates visibility from scratch. A row's position also resets on a full reload (e.g. app restart) or when it is removed by deletion.
- Rows alternate white and light gray backgrounds for scanability.
- The table includes these columns:

| Column | Content |
| --- | --- |
| Name | Stock name with its first `ETF` or `LOF` substring and all following text omitted for display |
| Quantity | Trade quantity |
| Buy Price | Buy price, or blank when no buy side is present; shown with 2 decimal places for stocks and 3 decimal places for ETFs/LOFs |
| Buy Date | Relative date label for the Buy date, or blank when no buy side is present; hovering shows the stored `YYYY-MM-DD` date |
| Sell Price | Sell price, or blank when no sell side is present; shown with 2 decimal places for stocks and 3 decimal places for ETFs/LOFs |
| Sell Date | Relative date label for the Sell date, or blank when no sell side is present; hovering shows the stored `YYYY-MM-DD` date |
| Profit | Net profit (see formula below) when quantity, buy price, and sell price are all present, regardless of whether dates are set; blank otherwise |
| Actions | Header labeled **Actions**; each cell holds the row's **Delete transaction** icon button |

- When a transaction has a note, a small right-aligned comment indicator (message icon) appears in the Name cell; hovering over the indicator shows only the full note text. Transactions without a note show no indicator.
- Table dates use elapsed ranges: less than one day is **today**; 1–<2, 2–<3, and 3–<7 days are **1 day ago**, **2 days ago**, and **3 days ago**; 1–<2 weeks is **1 week ago** and 2 weeks–<1 month is **2 weeks ago**; 1–<2, 2–<3, 3–<6, and 6–<12 months are **1 month ago**, **2 months ago**, **3 months ago**, and **6 months ago**; and 1–<2 years is **1 year ago**. Dates two or more years old retain their `YYYY-MM-DD` display. Hovering a non-empty date cell always shows its stored `YYYY-MM-DD` date.
- Buy Date and Sell Date text uses a smaller 13px font in the table.
- Hovering over a Name shows a tooltip containing the stored full stock name, stock code (with its leading market-prefix letters, e.g. `SH`/`SZ`, omitted for display), and, when available, the current price and current percentage. The quote uses the same red/green percentage color convention as price-cell popups.
- Hovering over a populated Buy Price or Sell Price cell for a short delay (matching the note comment indicator's deferred tooltip feel) shows a floating popup. When a live quote is available for that stock (see §6.1.2), the popup starts with a quote row: the live market quote appears at the left edge in the format `current price / current percentage` (e.g. `10.42 / +15.78%`), the stock's display name (with its `ETF`/`LOF` suffix omitted, matching the table's Name display) is centered in the middle, and the right edge shows the reference transaction's total current profit in the same large font, followed by the current price's amount and percentage change against the hovered cell's transaction price in the original smaller font (e.g. `+42.00  +0.42 / +4.20%`). For a Buy Price, these reference values use `current price - hovered transaction price`; for a Sell Price, they use `hovered transaction price - current price`. Total reference profit is that difference × quantity. The current price and current market percentage are both red for a positive current percentage and green for a negative current percentage; the reference-transaction values are also red for a positive reference difference and green for a negative one (mainland A-share convention). Price values use the price cell's decimal precision. Below that (or directly at the top when no live quote is available yet) are two horizontal tables: an upper table with one column per +1% through +10% step, and a lower table with one column per -1% through -10% step, each with a header row of percentage changes above a row of the corresponding computed prices (using the same 2-or-3-decimal precision as the price cell). When a live quote is available, the single computed price across both tables that is nearest to the current live price is bolded, colored (red if from the +1%..+10% table, green if from the -1%..-10% table), and given a light yellow background, along with its percentage header cell. The popup is centered under the price cell and disappears immediately when the cursor leaves; when it would extend below the viewport, it is positioned above the hovered price cell instead. Empty price cells show no popup.
- Closed transactions (quantity, buy price/date, and sell price/date all present) are rendered with a gray font color to visually distinguish them from open rows.
- The Profit column shows the **net profit** whenever quantity, buy price, and sell price are all present (buy/sell dates are not required), computed as:
  - `rate` = the configured **Trade fee rate** (default `0.025%`), `min_fee` = the configured **Minimum trade fee** (default `5`, applied per side)
  - `stamp_duty` = the configured **Stamp duty rate** (default `0.05%`) for ordinary A-share stocks, or `0%` for ETFs/LOFs, applied only to the sell side
  - `buy_fee = buy_price * quantity * rate`, `sell_fee = sell_price * quantity * rate`
  - `stamp_fee = sell_price * quantity * stamp_duty`
  - `gross_profit = (sell_price - buy_price) * quantity`
  - `net_profit = gross_profit - max(min_fee, buy_fee) - max(min_fee, sell_fee) - stamp_fee`
  - These rates are configurable in **Settings → Stock Fee** (see §6.1.5).
- Hovering over a populated Profit cell shows the signed net-profit percentage using the same fees and stamp duty as the Profit calculation: `net_profit / (buy_price × quantity)`. Positive values are red and negative values are green.
- An empty Buy Date or Sell Date cell has a yellow background when the matching price is present.
- Double-clicking a row opens an **Edit transaction** dialog (see §8) pre-filled with that row's current values, allowing the quantity, buy/sell price and date fields and note to be changed and saved back to the same transaction.
- Each row ends with a **Delete transaction** icon button (visible on hover). Clicking it opens a confirmation dialog styled like the Create Transaction dialog, naming the affected stock; confirming permanently removes that transaction from its stock's ledger file and refreshes the table, while Cancel or closing the dialog leaves the transaction untouched. A deletion error is shown inside the confirmation dialog without closing it.
- When no records match, show a clear empty state that directs the user to create a transaction.

## 7. Merge Transactions Dialog

The **Merge** menu action opens a modal **Merge transactions** dialog for combining multiple valid open transactions of the same stock and same side (all open buys, or all open sells) into a single weighted-average transaction.

- **Stock**: a combobox identical in appearance to the Create dialog's, but restricted to stocks that already have at least one recorded ledger entry (no `stock-api` search). Selecting a stock loads its valid open transactions (same definition used elsewhere: an open buy needs quantity, Buy price, and Buy date with no Sell price; an open sell needs quantity, Sell price, and Sell date with no Buy price). When a live quote is available for the selected stock, its current price and percentage are shown inside the combobox after the stock name, using the same red/green market-change convention as the Create dialog and main table.
- **Transactions table**: below the stock combobox, a table lists every valid open transaction for the selected stock, one row per transaction, with a leading checkbox column plus Side (Buy/Sell), Quantity, Price, Date, and Note columns. The table is always visible, even before a stock is selected (shown empty in that case); its area is a fixed height of exactly 4 visible rows (with a scrollbar when there are more rows, and empty space below the rows when there are fewer), and its header stays pinned while scrolling. Once a stock is selected, if it has no valid open transactions, an empty-state message is additionally shown below the (empty) table.
- **Selection rules**: at least two rows must be checked before merging; the **Merge** button stays disabled otherwise. Checking any row of one side (buy or sell) disables the checkboxes of every row on the opposite side, so the checked rows are always the same side; unchecking all rows of the checked side re-enables the other side's checkboxes.
- **Merge computation**: for the checked rows (all the same side), the merged transaction's quantity is the sum of the checked quantities; its price is the quantity-weighted average of the checked prices (`Σ (price × quantity) / Σ quantity`); its date is the latest (most recent) of the checked dates; its note is the non-empty notes from the checked rows joined with newlines. The merged transaction receives a new UUID and fresh creation/modification timestamps.
- **Merge detail panel**: a detail panel is always shown directly below the transactions table (in the same dialog), using Create-style read-only controls for Quantity, Price, Date, and Note; Side is not shown in this panel. It stays visible (with blank fields) before a stock is selected or before enough rows are checked, and live-updates to show the computed merge values as soon as two or more valid open rows of the same side are checked. Clicking **Merge** then performs the merge directly.
- Clicking **Merge** atomically replaces the checked transactions with the single merged transaction in the stock's ledger file, and the main table refreshes. A merge error (e.g. a selected transaction no longer exists) is shown inside the dialog without closing it.

## 8. Create/Edit Transaction Dialog

The **Create** action opens a modal dialog containing:

| Field | Description |
| --- | --- |
| Stock | Required unified combobox; see interaction below |
| Quantity | Optional positive whole number; defaults to `1000`; increments/decrements by `100`; must be a multiple of `100`; decimal points cannot be entered |
| Buy price | Optional positive number; at least one of Buy price or Sell price is required; the spinbox step matches the selected stock's decimal precision (0.01 for stocks, 0.001 for ETFs/LOFs) |
| Buy date | Optional date, empty by default; requires a Buy price; the unset `mm/dd/yyyy` placeholder is shown in gray |
| Sell price | Optional positive number; at least one of Buy price or Sell price is required; the spinbox step matches the selected stock's decimal precision (0.01 for stocks, 0.001 for ETFs/LOFs) |
| Sell date | Optional date, empty by default; requires a Sell price; the unset `mm/dd/yyyy` placeholder is shown in gray |
| Note | Optional free-text note, entered in a multi-line text area at the bottom of the dialog |

The dialog field order is **Stock**, **Quantity**, then the **Buy price**/**Buy date** pair, then the **Sell price**/**Sell date** pair, and finally **Note** at the bottom. Stock and at least one price are required; Quantity, both dates, and Note may be left empty. A price may be recorded without its matching date, but a date cannot be recorded without its matching price. The stock combobox has the placeholder **Select or search a stock**. Selected/listed stocks are shown as `name (code)`, with the code's leading market-prefix letters omitted for display. When a live quote is available for the selected stock, its current price and percentage are shown inside the combobox after the stock name, using the same red/green market-change convention as the table. Clicking its arrow opens the locally recorded stocks. Typing a name or code and pressing Enter replaces that list with matching `stock-api` results. Clearing the input and pressing Enter restores the locally recorded-stock list. Clicking anywhere outside the combobox closes its open list.

Search results are restricted to mainland A-share stocks, ETFs, and LOFs (Shanghai/Shenzhen main board, ChiNext, and STAR market codes plus Shanghai/Shenzhen ETF and LOF codes). Index quotes (e.g. SH000300, SZ399006) and non A-share markets (e.g. Hong Kong or US codes) are excluded from the results.

The dialog provides **Cancel** and **Save** actions. Errors from validation, local storage, or stock lookup must be shown clearly. A stock lookup failure must not prevent the user from selecting an existing locally recorded stock.

Double-clicking a table row reopens the same dialog, titled **Edit transaction**, pre-filled with that transaction's current Quantity, Buy price/date, Sell price/date, and Note. In edit mode, the Stock field is locked (shown disabled) since a transaction cannot be moved to a different stock; only Quantity, Buy price/date, Sell price/date, and Note may be changed. Saving calls the update path and writes the same transaction record (identified by its stock code and UUID) back to its ledger file, preserving its original UUID and creation timestamp while refreshing its modification timestamp; Cancel or closing the dialog discards any changes.

## 9. Acceptance Criteria

1. A user can save a transaction with only a buy price and date and see it as an open buy row in the table.
2. A user can save a transaction with only a sell price and date and see it as an open sell row in the table.
3. A user can save a transaction with both a buy price/date and a sell price/date and see it as a closed row in the table.
4. A user can save a transaction with a price but no matching date; a date without its matching price is rejected.
5. A user cannot save a transaction with neither a Buy Price nor a Sell Price.
6. Closing and reopening the application retains saved transactions from the local JSON ledger files.
7. Filtering by checked stock names, status, or period updates the visible rows immediately.
8. A stock-search error is visible in the dialog and does not hide existing local stock choices.
9. Clicking a row's **Delete transaction** icon opens a confirmation dialog; confirming removes that transaction from the ledger file and from the table, while Cancel leaves it unchanged. A deletion error is shown inside the dialog without removing other rows.
10. Double-clicking a row opens an **Edit transaction** dialog pre-filled with its current values and a locked Stock field; saving updates that transaction in place (keeping its UUID and creation timestamp) and refreshes the table, while Cancel leaves the transaction unchanged.
11. The Merge transactions dialog always shows the transactions table, even before a stock is selected; selecting a stock with no valid open transactions additionally shows an empty-state message below the table.
12. Checking fewer than two rows keeps the **Merge** button disabled. Checking a row of one side disables the checkboxes of every row on the opposite side, preventing mixed-side selections.
13. The Merge transactions dialog always shows a merge detail panel below the table (blank before selection); checking two or more valid open rows of the same side instantly fills it in with the computed quantity, weighted-average price, latest date, and combined note; clicking **Merge** replaces the selected transactions with one merged transaction and refreshes the table.
