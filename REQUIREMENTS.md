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
| Storage | Local JSON files in the application data directory |
| Transactions | Create and delete buy and sell transactions |
| Stock selection | A unified combobox for existing stocks and search through [`stock-api`](https://github.com/zhangxiangliang/stock-api) |
| Ledger behavior | Transactions can be created, edited (double-click a row), and deleted (via a delete icon at the end of each row) |
| Lot shape | Each transaction directly carries its own optional buy price/date and sell price/date |

The first release does **not** include partial lot closing, transaction editing, portfolio performance calculations, cloud synchronization, or a configurable storage location.

## 3. Technology

- **Desktop runtime:** Tauri
- **Frontend:** React and TypeScript
- **Frontend tests:** Vitest and React Testing Library
- **Backend tests:** Rust `cargo test`

## 4. Local Ledger Storage

### 4.1 Location and files

- Ledger files are stored in the Tauri application data directory under a `stocks` folder.
- Each file represents one stock and is named `<stock-code>.json`.
- A stock code may contain letters, numbers, hyphens, and underscores.
- Saving a transaction updates only that stock's ledger file.

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
| `buyPrice` | Optional buy price; must be a positive number when present, independent of `buyDate` |
| `buyDate` | Optional buy date in `YYYY-MM-DD` format when present, independent of `buyPrice` |
| `sellPrice` | Optional sell price; must be a positive number when present, independent of `sellDate` |
| `sellDate` | Optional sell date in `YYYY-MM-DD` format when present, independent of `sellPrice` |
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
- Each price, when present, must be a finite positive value; each date, when present, must use `YYYY-MM-DD`. Prices and dates are validated independently of one another.
- Prices are rounded before being saved: ordinary A-share stocks are stored with 2 decimal places, while ETFs and LOFs are stored with 3 decimal places.
- Transactions can be edited in place by double-clicking their row, or removed entirely via the trading record table's row **Delete transaction** icon.

## 6. User Interface

The interface uses a clean, Excel-inspired layout with a light ribbon-style application menu, a compact filter strip, and a high-density data table.

### 6.1 Menu bar

| Menu item | Behavior |
| --- | --- |
| **Create** | Opens the transaction creation dialog |
| **Settings** | Shows a placeholder dialog for a future release |
| **About** | Shows a short application description |

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
- Rows are sorted by stock name, then ascending buy date (rows with no buy date sort first within their name).
- Rows alternate white and light gray backgrounds for scanability.
- The table includes these columns:

| Column | Content |
| --- | --- |
| Name | Stock name |
| Quantity | Trade quantity |
| Buy Price | Buy price, or blank when no buy side is present; shown with 2 decimal places for stocks and 3 decimal places for ETFs/LOFs |
| Buy Date | Buy date, or blank when no buy side is present |
| Sell Price | Sell price, or blank when no sell side is present; shown with 2 decimal places for stocks and 3 decimal places for ETFs/LOFs |
| Sell Date | Sell date, or blank when no sell side is present |
| Actions | Header labeled **Actions**; each cell holds the row's **Delete transaction** icon button |

- When a transaction has a note, a small comment indicator (message icon) is appended after the stock name in the Name cell; hovering over the indicator shows the full note text in a tooltip popup. Transactions without a note show no indicator.
- Hovering over a populated Buy Price or Sell Price cell for a short delay (matching the note comment indicator's deferred tooltip feel) shows a floating popup with two horizontal tables: an upper table with one column per +1% through +10% step, and a lower table with one column per -1% through -10% step, each with a header row of percentage changes above a row of the corresponding computed prices (using the same 2-or-3-decimal precision as the price cell). The popup is centered under the price cell and disappears immediately when the cursor leaves. Empty price cells show no popup.
- Closed transactions (quantity, buy price/date, and sell price/date all present) are rendered with a gray font color to visually distinguish them from open rows.
- Double-clicking a row opens an **Edit transaction** dialog (see §7) pre-filled with that row's current values, allowing the quantity, buy/sell price and date fields, and note to be changed and saved back to the same transaction.
- Each row ends with a **Delete transaction** icon button (visible on hover). Clicking it opens a confirmation dialog styled like the Create Transaction dialog, naming the affected stock; confirming permanently removes that transaction from its stock's ledger file and refreshes the table, while Cancel or closing the dialog leaves the transaction untouched. A deletion error is shown inside the confirmation dialog without closing it.
- When no records match, show a clear empty state that directs the user to create a transaction.

## 7. Create/Edit Transaction Dialog

The **Create** action opens a modal dialog containing:

| Field | Description |
| --- | --- |
| Stock | Required unified combobox; see interaction below |
| Quantity | Optional positive whole number; defaults to `1000`; increments/decrements by `100`; must be a multiple of `100`; decimal points cannot be entered |
| Buy price | Optional positive number, independent of Buy date |
| Buy date | Optional date, empty by default, independent of Buy price; the unset `mm/dd/yyyy` placeholder is shown in gray |
| Sell price | Optional positive number, independent of Sell date |
| Sell date | Optional date, empty by default, independent of Sell price; the unset `mm/dd/yyyy` placeholder is shown in gray |
| Note | Optional free-text note, entered in a multi-line text area at the bottom of the dialog |

The dialog field order is **Stock**, **Quantity**, then the **Buy price**/**Buy date** pair, then the **Sell price**/**Sell date** pair, and finally **Note** at the bottom. Only Stock is required; Quantity, Buy price, Buy date, Sell price, Sell date, and Note may each be left empty independently of one another and filled in in any combination (for example, both sides at once to record an already-closed round-trip in a single transaction, or a price without its matching date). The stock combobox has the placeholder **Select or search a stock**. Clicking its arrow opens the locally recorded stocks. Typing a name or code and pressing Enter replaces that list with matching `stock-api` results. Clearing the input and pressing Enter restores the locally recorded-stock list. Clicking anywhere outside the combobox closes its open list.

Search results are restricted to mainland A-share stocks, ETFs, and LOFs (Shanghai/Shenzhen main board, ChiNext, and STAR market codes plus Shanghai/Shenzhen ETF and LOF codes). Index quotes (e.g. SH000300, SZ399006) and non A-share markets (e.g. Hong Kong or US codes) are excluded from the results.

The dialog provides **Cancel** and **Save** actions. Errors from validation, local storage, or stock lookup must be shown clearly. A stock lookup failure must not prevent the user from selecting an existing locally recorded stock.

Double-clicking a table row reopens the same dialog, titled **Edit transaction**, pre-filled with that transaction's current Quantity, Buy price/date, Sell price/date, and Note. In edit mode, the Stock field is locked (shown disabled) since a transaction cannot be moved to a different stock; only Quantity, Buy price/date, Sell price/date, and Note may be changed. Saving calls the update path and writes the same transaction record (identified by its stock code and UUID) back to its ledger file, preserving its original UUID and creation timestamp while refreshing its modification timestamp; Cancel or closing the dialog discards any changes.

## 8. Acceptance Criteria

1. A user can save a transaction with only a buy price and date and see it as an open buy row in the table.
2. A user can save a transaction with only a sell price and date and see it as an open sell row in the table.
3. A user can save a transaction with both a buy price/date and a sell price/date and see it as a closed row in the table.
4. A user can save a transaction with a price but no matching date, or a date but no matching price, since each field is independently optional.
5. A user can save a transaction with only a stock selected and every other field left empty.
6. Closing and reopening the application retains saved transactions from the local JSON ledger files.
7. Filtering by checked stock names, status, or period updates the visible rows immediately.
8. A stock-search error is visible in the dialog and does not hide existing local stock choices.
9. Clicking a row's **Delete transaction** icon opens a confirmation dialog; confirming removes that transaction from the ledger file and from the table, while Cancel leaves it unchanged. A deletion error is shown inside the dialog without removing other rows.
10. Double-clicking a row opens an **Edit transaction** dialog pre-filled with its current values and a locked Stock field; saving updates that transaction in place (keeping its UUID and creation timestamp) and refreshes the table, while Cancel leaves the transaction unchanged.

