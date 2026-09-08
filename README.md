# Little V

Little V is a Tauri + React desktop app for keeping a local record of stock buy/sell
transactions. Each stock is persisted as its own JSON ledger file on disk; no
external database or server is required. See [REQUIREMENTS.md](./REQUIREMENTS.md)
for the full product specification.

## Tech stack

- [Tauri 2](https://tauri.app/) (Rust backend, native webview shell)
- React 19 + TypeScript (frontend, built with Vite)
- Vitest + React Testing Library (frontend tests)
- Rust `cargo test` (backend tests)

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain) and Cargo
- Tauri's platform-specific system dependencies — follow the
  [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) for your OS
  (on Windows this includes the Microsoft C++ Build Tools and WebView2)

## Setup

Install frontend dependencies:

```powershell
npm install
```

Rust dependencies are fetched automatically by Cargo the first time you build or
run the app (no separate install step needed).

## Running in development

Start the app with hot-reload for both the React frontend and the Tauri shell:

```powershell
npm run tauri dev
```

This launches a native window backed by the local Vite dev server. Frontend
changes hot-reload; Rust changes trigger a rebuild of the backend.

To work on the frontend alone in a browser (without the Tauri shell, e.g. for
quick UI iteration), you can also run:

```powershell
npm run dev
```

Note that `invoke`-based calls to Rust commands won't work outside the Tauri
shell, so full functionality requires `npm run tauri dev`.

## Building

Build a release desktop bundle (installer/executable for your current platform):

```powershell
npm run tauri build
```

To build only the frontend static assets (type-checks with `tsc`, then bundles
with Vite) without packaging the Tauri app:

```powershell
npm run build
```

## Testing

Run the frontend test suite (Vitest + React Testing Library):

```powershell
npm test
```

Run the Rust backend test suite:

```powershell
cd src-tauri
cargo test
```

Both suites should be run after any change touching their respective side of
the codebase; frontend changes should also pass `npm run build` to catch type
errors.

## Project structure

```
src/                  React + TypeScript frontend
  App.tsx             Main UI: menu bar, filters, trading table, dialogs
  ledger.ts           Ledger/transaction types and table-row projection
  stockApi.ts         Stock search client (A-share stocks/ETFs/LOFs)
src-tauri/            Rust backend (Tauri commands)
  src/lib.rs          Ledger storage, validation, create/update/delete commands
REQUIREMENTS.md        Living product specification
```

## Data storage

Ledger data is stored as one JSON file per stock code in the Tauri application
data directory (the OS-specific per-app data folder Tauri resolves at
runtime). No data leaves the local machine.
