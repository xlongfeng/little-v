# Copilot instructions for Little V

## Build and test

- `npm run tauri dev` runs the desktop app with Vite hot reload. `npm run dev` runs only the frontend; Tauri `invoke` commands require the desktop shell.
- `npm run build` runs `tsc` and then `vite build`.
- `npm test` runs the frontend Vitest suite. Run one file with `npx vitest run src/App.test.tsx`, or one named test with `npx vitest run src/App.test.tsx -t "duplicates a transaction"`.
- Run Rust tests from `src-tauri` with `cargo test`; filter to one test with `cargo test deletes_a_transaction_by_uuid`.
- `npm run tauri build` packages a release desktop app.

## Architecture

- `src/main.tsx` selects the main UI or ticker overlay from the `?view=ticker` query parameter. The Tauri configuration and window setup live in `src-tauri/tauri.conf.json` and `src-tauri/src/lib.rs`.
- The React UI calls registered Rust commands through `@tauri-apps/api/core` `invoke`. Rust owns validation and persistence: each stock has a JSON ledger file under `<data root>/stocks`, and the selected data root defaults to `Documents/Little V`. Rust file watching emits `stock-ledgers-changed` so the main table reloads after external file changes.
- A transaction contains its own optional buy and sell fields; it is not represented as separate linked buy/sell records. `src/ledger.ts` defines the shared frontend types, calculations, sorting, and projection helpers used by the table.
- `src/App.tsx` is the main screen and transaction/settings dialogs. `LanguageProvider`, `PriceFeedProvider`, and `ProfitSettingsProvider` provide shared UI state. Preferences use WebView `localStorage`; changing the persisted ledger folder is handled by Rust.
- The ticker is a separate Tauri webview rendered by `src/Ticker.tsx`. The main window coordinates quote polling; the ticker subscribes to the Rust quote cache/events. Keep event names and payload shapes in sync between the frontend and Rust, and unsubscribe listeners when components unmount.
- `src/stockApi.ts` wraps stock search and quote fetching. Transaction stock search is filtered to A-share stocks, ETFs, and LOFs; ticker search also allows indices.

## Repository conventions

- `REQUIREMENTS.md` is the detailed product behavior reference. Keep it in sync when changing user-visible behavior, and cover both English and Simplified Chinese strings in `src/i18n.ts`.
- Add or update frontend tests alongside the affected feature (`src/*.test.ts` / `src/*.test.tsx`). The test suite uses Vitest, jsdom, and React Testing Library; Tauri APIs and stock API calls are mocked in UI tests. Rust storage and validation tests are in `src-tauri/src/lib.rs` and use temporary directories.
- Tauri command names and argument casing form a cross-language interface: frontend `invoke("command_name", { camelCaseArgs })` calls Rust command wrappers, and request structs use `#[serde(rename_all = "camelCase")]`. Update both sides together.
- Keep file-system work and ledger validation in Rust command/helper code rather than the React UI. Emit the existing Tauri events when state changes need to reach another window or respond to external ledger-file changes.
