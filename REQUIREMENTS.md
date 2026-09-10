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
| **Settings** | Shows **General** (Language), **Storage** (data folder), **Stock Quotes** (refresh interval), and **Stock Fee** (stamp duty rate, trade fee rate, minimum trade fee) groups. All changes are staged in the dialog and only take effect after **Save**; the dialog also offers **Default** (resets the in-progress draft to the built-in defaults, without applying it) and **Cancel** (closes the dialog and discards any unsaved changes) |
| **About** | Shows the dialog title **About Little V** followed by the app version (**Version `X.Y.Z`**) in a smaller font, and a short application description |

At the far right of the menu bar, a **Total profit** indicator shows the sum of Profit (see §6.3 for the formula) across all currently visible rows (i.e. after applying the Filters).

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

- The Settings dialog stages every field (Language, data folder, Refresh interval, and the Stock Fee fields below) in a local draft; opening the dialog initializes the draft from the currently applied values. Language selection is the exception in presentation only: it immediately previews the selected language, without applying or persisting it.
- **Save** validates and applies the entire draft at once (data folder, Language, Refresh interval, and Stock Fee settings together). Every applied setting is persisted in browser `localStorage`.
- **Default** resets only the in-progress draft to the built-in defaults (System Default language, 3-second refresh interval, and the default Stock Fee values below); it does **not** apply or persist anything until **Save** is subsequently clicked.
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

- Changed values apply to the Profit column and the menu bar's Total profit indicator immediately after **Save**, and are persisted in browser `localStorage` (`littlev-profit-settings`).

### 6.2 Filters

- Appears directly below the menu bar as a **Filters** toolbar.
- **Names**: an Excel-style dropdown checklist of available stock names.
  - Includes an **All** checkbox that toggles every stock name at once.
  - Each stock name has a checkbox.
  - Checked names remain visible in the trading record table; unchecked names are hidden.
  - The name list is generated from the loaded ledger rows.
  - The collapsed summary shows **All** when every name is checked, otherwise **`N` selected**.
  - Clicking outside the checklist closes it.
- **Status**: a dropdown to show **All**, **Open only** (missing quantity, a buy price/date, or a sell price/date), or **Closed only** (has quantity, buy price, buy date, sell price, and sell date all present).
- **Period**: a dropdown to show **All**, **Last 6 months**, **Last year**, or **Last 2 years**, based on the most recent of a row's buy date and sell date. Rows with neither a buy date nor a sell date are always included, regardless of the selected period.
- All three filters combine (AND) to determine the visible rows.
- Displays the number of matching records.

### 6.3 Trading record table

- Shows one row per transaction.
- A transaction with only a buy side shows empty sell values; one with only a sell side shows empty buy values.
- Rows are sorted by stock name, then ascending Buy Price; rows without a Buy Price use their Sell Price instead, and rows without either price sort first within their name.
- Rows alternate white and light gray backgrounds for scanability.
- The table includes these columns:

| Column | Content |
| --- | --- |
| Name | Stock name with its first `ETF` or `LOF` substring and all following text omitted for display |
| Quantity | Trade quantity |
| Buy Price | Buy price, or blank when no buy side is present; shown with 2 decimal places for stocks and 3 decimal places for ETFs/LOFs |
| Buy Date | Buy date, or blank when no buy side is present |
| Sell Price | Sell price, or blank when no sell side is present; shown with 2 decimal places for stocks and 3 decimal places for ETFs/LOFs |
| Sell Date | Sell date, or blank when no sell side is present |
| Profit | Net profit (see formula below) when quantity, buy price, and sell price are all present, regardless of whether dates are set; blank otherwise |
| Actions | Header labeled **Actions**; each cell holds the row's **Delete transaction** icon button |

- When a transaction has a note, a small right-aligned comment indicator (message icon) appears in the Name cell; hovering over the indicator shows only the full note text. Transactions without a note show no indicator.
- Hovering over a Name shows a tooltip containing the stored full stock name, stock code, and, when available, the current price and current percentage. The quote uses the same red/green percentage color convention as price-cell popups.
- Hovering over a populated Buy Price or Sell Price cell for a short delay (matching the note comment indicator's deferred tooltip feel) shows a floating popup. When a live quote is available for that stock (see §6.1.2), the popup starts with a quote row: the live market quote appears at the left edge in the format `current price / current percentage` (e.g. `10.42 / +15.78%`), and the right edge shows the reference transaction's total current profit in the same large font, followed by the current price's amount and percentage change against the hovered cell's transaction price in the original smaller font (e.g. `+42.00  +0.42 / +4.20%`). For a Buy Price, these reference values use `current price - hovered transaction price`; for a Sell Price, they use `hovered transaction price - current price`. Total reference profit is that difference × quantity. The current price and current market percentage are both red for a positive current percentage and green for a negative current percentage; the reference-transaction values are also red for a positive reference difference and green for a negative one (mainland A-share convention). Price values use the price cell's decimal precision. Below that (or directly at the top when no live quote is available yet) are two horizontal tables: an upper table with one column per +1% through +10% step, and a lower table with one column per -1% through -10% step, each with a header row of percentage changes above a row of the corresponding computed prices (using the same 2-or-3-decimal precision as the price cell). The popup is centered under the price cell and disappears immediately when the cursor leaves; when it would extend below the viewport, it is positioned above the hovered price cell instead. Empty price cells show no popup.
- Closed transactions (quantity, buy price/date, and sell price/date all present) are rendered with a gray font color to visually distinguish them from open rows.
- The Profit column shows the **net profit** whenever quantity, buy price, and sell price are all present (buy/sell dates are not required), computed as:
  - `rate` = the configured **Trade fee rate** (default `0.025%`), `min_fee` = the configured **Minimum trade fee** (default `5`, applied per side)
  - `stamp_duty` = the configured **Stamp duty rate** (default `0.05%`) for ordinary A-share stocks, or `0%` for ETFs/LOFs, applied only to the sell side
  - `buy_fee = buy_price * quantity * rate`, `sell_fee = sell_price * quantity * rate`
  - `stamp_fee = sell_price * quantity * stamp_duty`
  - `gross_profit = (sell_price - buy_price) * quantity`
  - `net_profit = gross_profit - max(min_fee, buy_fee) - max(min_fee, sell_fee) - stamp_fee`
  - These rates are configurable in **Settings → Stock Fee** (see §6.1.5).
- An empty Buy Date or Sell Date cell has a yellow background when the matching price is present.
- Double-clicking a row opens an **Edit transaction** dialog (see §7) pre-filled with that row's current values, allowing the quantity, buy/sell price and date fields and note to be changed and saved back to the same transaction.
- Each row ends with a **Delete transaction** icon button (visible on hover). Clicking it opens a confirmation dialog styled like the Create Transaction dialog, naming the affected stock; confirming permanently removes that transaction from its stock's ledger file and refreshes the table, while Cancel or closing the dialog leaves the transaction untouched. A deletion error is shown inside the confirmation dialog without closing it.
- When no records match, show a clear empty state that directs the user to create a transaction.

## 7. Create/Edit Transaction Dialog

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

The dialog field order is **Stock**, **Quantity**, then the **Buy price**/**Buy date** pair, then the **Sell price**/**Sell date** pair, and finally **Note** at the bottom. Stock and at least one price are required; Quantity, both dates, and Note may be left empty. A price may be recorded without its matching date, but a date cannot be recorded without its matching price. The stock combobox has the placeholder **Select or search a stock**. Clicking its arrow opens the locally recorded stocks. Typing a name or code and pressing Enter replaces that list with matching `stock-api` results. Clearing the input and pressing Enter restores the locally recorded-stock list. Clicking anywhere outside the combobox closes its open list.

Search results are restricted to mainland A-share stocks, ETFs, and LOFs (Shanghai/Shenzhen main board, ChiNext, and STAR market codes plus Shanghai/Shenzhen ETF and LOF codes). Index quotes (e.g. SH000300, SZ399006) and non A-share markets (e.g. Hong Kong or US codes) are excluded from the results.

The dialog provides **Cancel** and **Save** actions. Errors from validation, local storage, or stock lookup must be shown clearly. A stock lookup failure must not prevent the user from selecting an existing locally recorded stock.

Double-clicking a table row reopens the same dialog, titled **Edit transaction**, pre-filled with that transaction's current Quantity, Buy price/date, Sell price/date, and Note. In edit mode, the Stock field is locked (shown disabled) since a transaction cannot be moved to a different stock; only Quantity, Buy price/date, Sell price/date, and Note may be changed. Saving calls the update path and writes the same transaction record (identified by its stock code and UUID) back to its ledger file, preserving its original UUID and creation timestamp while refreshing its modification timestamp; Cancel or closing the dialog discards any changes.

## 8. Acceptance Criteria

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
