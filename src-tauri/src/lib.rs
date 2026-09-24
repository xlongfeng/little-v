use chrono::Utc;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, RecvTimeoutError},
        Arc, Mutex, MutexGuard,
    },
    thread,
    time::Duration,
};
use tauri::{
    Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use uuid::Uuid;

const STOCK_LEDGERS_CHANGED_EVENT: &str = "stock-ledgers-changed";
const TICKER_STOCKS_CHANGED_EVENT: &str = "ticker-stocks-changed";
const TICKER_POSITION_CHANGED_EVENT: &str = "ticker-position-changed";
const TICKER_VISIBILITY_CHANGED_EVENT: &str = "ticker-visibility-changed";
const TICKER_OPACITY_CHANGED_EVENT: &str = "ticker-opacity-changed";
const STOCK_QUOTES_UPDATED_EVENT: &str = "stock-quotes-updated";
const TICKER_WINDOW_LABEL: &str = "ticker";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub uuid: String,
    pub create_date: String,
    pub modify_date: String,
    pub quantity: Option<i64>,
    pub buy_price: Option<f64>,
    pub buy_date: Option<String>,
    pub sell_price: Option<f64>,
    pub sell_date: Option<String>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct StockLedger {
    pub code: String,
    pub name: String,
    pub transactions: Vec<Transaction>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockQuote {
    pub code: String,
    pub now: f64,
    pub yesterday: f64,
    pub percent: f64,
}

struct QuoteCacheState(Mutex<HashMap<String, StockQuote>>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTransactionRequest {
    pub name: String,
    pub code: String,
    pub quantity: Option<i64>,
    pub buy_price: Option<f64>,
    pub buy_date: Option<String>,
    pub sell_price: Option<f64>,
    pub sell_date: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTransactionRequest {
    pub code: String,
    pub uuid: String,
    pub quantity: Option<i64>,
    pub buy_price: Option<f64>,
    pub buy_date: Option<String>,
    pub sell_price: Option<f64>,
    pub sell_date: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeTransactionsRequest {
    pub code: String,
    pub uuids: Vec<String>,
    pub quantity: Option<i64>,
    pub buy_price: Option<f64>,
    pub buy_date: Option<String>,
    pub sell_price: Option<f64>,
    pub sell_date: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitTransactionRequest {
    pub code: String,
    pub uuid: String,
    pub left_quantity: Option<i64>,
    pub left_price: Option<f64>,
    pub right_quantity: Option<i64>,
    pub right_price: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct TickerStock {
    pub code: String,
    pub name: String,
    pub lower: String,
    pub upper: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TickerPosition {
    x: i32,
    y: i32,
}

struct StorageInner {
    root: PathBuf,
    _watcher: RecommendedWatcher,
}

struct StorageState {
    inner: Mutex<StorageInner>,
    watcher_generation: Arc<AtomicU64>,
}

impl StorageState {
    fn lock(&self) -> Result<MutexGuard<'_, StorageInner>, String> {
        self.inner
            .lock()
            .map_err(|_| "Storage state is unavailable because its lock was poisoned.".into())
    }
}

fn ledger_directory(storage_root: &Path) -> PathBuf {
    storage_root.join("stocks")
}

fn ticker_path(storage_root: &Path) -> PathBuf {
    storage_root.join("ticker.jsonl")
}

fn stock_path(storage_root: &Path, code: &str) -> Result<PathBuf, String> {
    if code.is_empty()
        || !code.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err(
            "Stock code may contain only letters, numbers, hyphens, and underscores.".into(),
        );
    }

    Ok(ledger_directory(storage_root).join(format!("{code}.json")))
}

fn write_json_file(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let serialized = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Could not serialize {}: {error}", path.display()))?;
    let temporary_path = path.with_extension("json.tmp");
    fs::write(&temporary_path, serialized)
        .map_err(|error| format!("Could not stage {}: {error}", path.display()))?;
    fs::rename(&temporary_path, path)
        .map_err(|error| format!("Could not save {}: {error}", path.display()))
}

fn load_ticker_stocks_from(storage_root: &Path) -> Result<Vec<TickerStock>, String> {
    let path = ticker_path(storage_root);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    content
        .lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .map(|(index, line)| {
            serde_json::from_str(line).map_err(|error| {
                format!(
                    "Could not parse {} line {}: {error}",
                    path.display(),
                    index + 1
                )
            })
        })
        .collect()
}

fn validate_ticker_stocks(stocks: &[TickerStock]) -> Result<(), String> {
    let mut codes = std::collections::HashSet::new();
    for stock in stocks {
        let code = stock.code.trim().to_uppercase();
        if code.is_empty() || stock.name.trim().is_empty() {
            return Err("Ticker stocks require both a code and a name.".into());
        }
        if !code
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
        {
            return Err("Ticker stock codes may contain only letters and numbers.".into());
        }
        if !codes.insert(code) {
            return Err("The ticker stock list cannot contain duplicate codes.".into());
        }
    }
    Ok(())
}

fn save_ticker_stocks_to(storage_root: &Path, stocks: &[TickerStock]) -> Result<(), String> {
    validate_ticker_stocks(stocks)?;
    let path = ticker_path(storage_root);
    let temporary_path = path.with_extension("jsonl.tmp");
    let mut content = String::new();
    for stock in stocks {
        let normalized = TickerStock {
            code: stock.code.trim().to_uppercase(),
            name: stock.name.trim().to_string(),
            lower: stock.lower.trim().to_string(),
            upper: stock.upper.trim().to_string(),
        };
        content.push_str(
            &serde_json::to_string(&normalized)
                .map_err(|error| format!("Could not serialize {}: {error}", path.display()))?,
        );
        content.push('\n');
    }
    fs::write(&temporary_path, content)
        .map_err(|error| format!("Could not stage {}: {error}", path.display()))?;
    fs::rename(&temporary_path, &path)
        .map_err(|error| format!("Could not save {}: {error}", path.display()))
}

fn ensure_storage_root(storage_root: &Path) -> Result<(), String> {
    if storage_root.exists() && !storage_root.is_dir() {
        return Err(format!(
            "Data directory path is not a directory: {}",
            storage_root.display()
        ));
    }
    fs::create_dir_all(storage_root).map_err(|error| {
        format!(
            "Could not create data directory {}: {error}",
            storage_root.display()
        )
    })?;
    fs::create_dir_all(ledger_directory(storage_root)).map_err(|error| {
        format!(
            "Could not create stock ledger directory {}: {error}",
            ledger_directory(storage_root).display()
        )
    })?;

    Ok(())
}

fn load_ledgers_from(storage_root: &Path) -> Result<Vec<StockLedger>, String> {
    let directory = ledger_directory(storage_root);
    if !directory.exists() {
        return Ok(Vec::new());
    }

    let mut ledgers = fs::read_dir(directory)
        .map_err(|error| format!("Could not read ledger directory: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "json")
        })
        .map(|entry| {
            let path = entry.path();
            let content = fs::read_to_string(&path)
                .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
            serde_json::from_str(&content)
                .map_err(|error| format!("Could not parse {}: {error}", path.display()))
        })
        .collect::<Result<Vec<StockLedger>, String>>()?;

    ledgers.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(ledgers)
}

fn timestamp() -> String {
    Utc::now().to_rfc3339()
}

// Shanghai ETF/LOF codes use the 50/51/56/58 prefixes; Shenzhen ETF/LOF codes
// use the 15/16/18 prefixes. These funds are conventionally quoted with three
// decimal places instead of the two used for ordinary A-share stocks, so
// their prices are preserved with more precision when saved.
fn is_etf_or_lof_code(code: &str) -> bool {
    let code = code.trim().to_uppercase();
    if let Some(rest) = code.strip_prefix("SH") {
        return ["50", "51", "56", "58"]
            .iter()
            .any(|prefix| rest.starts_with(prefix));
    }
    if let Some(rest) = code.strip_prefix("SZ") {
        return ["15", "16", "18"]
            .iter()
            .any(|prefix| rest.starts_with(prefix));
    }
    false
}

fn round_price(price: Option<f64>, code: &str) -> Option<f64> {
    price.map(|value| {
        let decimals = if is_etf_or_lof_code(code) { 3 } else { 2 };
        let factor = 10f64.powi(decimals);
        (value * factor).round() / factor
    })
}

fn valid_date(date: &str) -> bool {
    date.len() == 10
        && date.as_bytes().get(4) == Some(&b'-')
        && date.as_bytes().get(7) == Some(&b'-')
        && date
            .chars()
            .enumerate()
            .all(|(index, character)| matches!(index, 4 | 7) || character.is_ascii_digit())
}

fn validate_side(price: Option<f64>, date: Option<&String>, side: &str) -> Result<(), String> {
    if let Some(price) = price {
        if !price.is_finite() || price <= 0.0 {
            return Err(format!("{side} price must be greater than zero."));
        }
    }
    if let Some(date) = date {
        if price.is_none() {
            return Err(format!("{side} price is required when {side} date is set."));
        }
        if !valid_date(date) {
            return Err(format!("{side} date must use YYYY-MM-DD."));
        }
    }
    Ok(())
}

fn validate_fields(
    quantity: Option<i64>,
    buy_price: Option<f64>,
    buy_date: Option<&String>,
    sell_price: Option<f64>,
    sell_date: Option<&String>,
) -> Result<(), String> {
    if let Some(quantity) = quantity {
        if quantity <= 0 {
            return Err("Quantity must be greater than zero.".into());
        }
        if quantity % 100 != 0 {
            return Err("Quantity must be a multiple of 100.".into());
        }
    }
    validate_side(buy_price, buy_date, "Buy")?;
    validate_side(sell_price, sell_date, "Sell")?;
    if buy_price.is_none() && sell_price.is_none() {
        return Err("A buy price or sell price is required.".into());
    }
    Ok(())
}

fn validate_request(request: &CreateTransactionRequest) -> Result<(), String> {
    if request.name.trim().is_empty() || request.code.trim().is_empty() {
        return Err("Select a stock before saving a transaction.".into());
    }
    validate_fields(
        request.quantity,
        request.buy_price,
        request.buy_date.as_ref(),
        request.sell_price,
        request.sell_date.as_ref(),
    )
}

fn save_transaction_to(
    storage_root: &Path,
    request: CreateTransactionRequest,
) -> Result<Transaction, String> {
    validate_request(&request)?;
    let code = request.code.trim().to_uppercase();
    let path = stock_path(storage_root, &code)?;
    fs::create_dir_all(ledger_directory(storage_root))
        .map_err(|error| format!("Could not create ledger directory: {error}"))?;

    let mut ledger = if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
        serde_json::from_str(&content)
            .map_err(|error| format!("Could not parse {}: {error}", path.display()))?
    } else {
        StockLedger {
            code: code.clone(),
            name: request.name.trim().to_string(),
            transactions: Vec::new(),
        }
    };

    let now = timestamp();
    let transaction = Transaction {
        uuid: Uuid::new_v4().to_string(),
        create_date: now.clone(),
        modify_date: now,
        quantity: request.quantity,
        buy_price: round_price(request.buy_price, &code),
        buy_date: request.buy_date,
        sell_price: round_price(request.sell_price, &code),
        sell_date: request.sell_date,
        note: request
            .note
            .as_deref()
            .map(str::trim)
            .filter(|note| !note.is_empty())
            .map(str::to_string),
    };

    ledger.transactions.push(transaction.clone());

    write_json_file(&path, &ledger)?;
    Ok(transaction)
}

fn delete_transaction_from(storage_root: &Path, code: &str, uuid: &str) -> Result<(), String> {
    let code = code.trim().to_uppercase();
    let path = stock_path(storage_root, &code)?;
    if !path.exists() {
        return Err(format!("No ledger found for stock code {code}."));
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let mut ledger: StockLedger = serde_json::from_str(&content)
        .map_err(|error| format!("Could not parse {}: {error}", path.display()))?;

    let original_len = ledger.transactions.len();
    ledger
        .transactions
        .retain(|transaction| transaction.uuid != uuid);
    if ledger.transactions.len() == original_len {
        return Err("Transaction not found.".into());
    }

    if ledger.transactions.is_empty() {
        fs::remove_file(&path)
            .map_err(|error| format!("Could not delete {}: {error}", path.display()))?;
    } else {
        write_json_file(&path, &ledger)?;
    }
    Ok(())
}

fn update_transaction_in(
    storage_root: &Path,
    request: UpdateTransactionRequest,
) -> Result<Transaction, String> {
    validate_fields(
        request.quantity,
        request.buy_price,
        request.buy_date.as_ref(),
        request.sell_price,
        request.sell_date.as_ref(),
    )?;

    let code = request.code.trim().to_uppercase();
    let path = stock_path(storage_root, &code)?;
    if !path.exists() {
        return Err(format!("No ledger found for stock code {code}."));
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let mut ledger: StockLedger = serde_json::from_str(&content)
        .map_err(|error| format!("Could not parse {}: {error}", path.display()))?;

    let transaction = ledger
        .transactions
        .iter_mut()
        .find(|transaction| transaction.uuid == request.uuid)
        .ok_or_else(|| "Transaction not found.".to_string())?;

    transaction.modify_date = timestamp();
    transaction.quantity = request.quantity;
    transaction.buy_price = round_price(request.buy_price, &code);
    transaction.buy_date = request.buy_date;
    transaction.sell_price = round_price(request.sell_price, &code);
    transaction.sell_date = request.sell_date;
    transaction.note = request
        .note
        .as_deref()
        .map(str::trim)
        .filter(|note| !note.is_empty())
        .map(str::to_string);
    let updated = transaction.clone();

    write_json_file(&path, &ledger)?;
    Ok(updated)
}

fn merge_transactions_in(
    storage_root: &Path,
    request: MergeTransactionsRequest,
) -> Result<Transaction, String> {
    if request.uuids.len() < 2 {
        return Err("Select at least two transactions to merge.".into());
    }
    validate_fields(
        request.quantity,
        request.buy_price,
        request.buy_date.as_ref(),
        request.sell_price,
        request.sell_date.as_ref(),
    )?;

    let code = request.code.trim().to_uppercase();
    let path = stock_path(storage_root, &code)?;
    if !path.exists() {
        return Err(format!("No ledger found for stock code {code}."));
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let mut ledger: StockLedger = serde_json::from_str(&content)
        .map_err(|error| format!("Could not parse {}: {error}", path.display()))?;

    let original_len = ledger.transactions.len();
    ledger
        .transactions
        .retain(|transaction| !request.uuids.contains(&transaction.uuid));
    if original_len - ledger.transactions.len() != request.uuids.len() {
        return Err("One or more selected transactions could not be found.".into());
    }

    let now = timestamp();
    let merged = Transaction {
        uuid: Uuid::new_v4().to_string(),
        create_date: now.clone(),
        modify_date: now,
        quantity: request.quantity,
        buy_price: round_price(request.buy_price, &code),
        buy_date: request.buy_date,
        sell_price: round_price(request.sell_price, &code),
        sell_date: request.sell_date,
        note: request
            .note
            .as_deref()
            .map(str::trim)
            .filter(|note| !note.is_empty())
            .map(str::to_string),
    };
    ledger.transactions.push(merged.clone());

    write_json_file(&path, &ledger)?;
    Ok(merged)
}

fn split_transaction_in(
    storage_root: &Path,
    request: SplitTransactionRequest,
) -> Result<(Transaction, Transaction), String> {
    let code = request.code.trim().to_uppercase();
    let path = stock_path(storage_root, &code)?;
    if !path.exists() {
        return Err(format!("No ledger found for stock code {code}."));
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let mut ledger: StockLedger = serde_json::from_str(&content)
        .map_err(|error| format!("Could not parse {}: {error}", path.display()))?;

    let original = ledger
        .transactions
        .iter()
        .find(|transaction| transaction.uuid == request.uuid)
        .cloned()
        .ok_or_else(|| "Transaction not found.".to_string())?;

    let is_buy = original.buy_price.is_some();
    let original_quantity = original
        .quantity
        .ok_or_else(|| "Only transactions with a quantity can be split.".to_string())?;

    let (left_quantity, right_quantity) = match (request.left_quantity, request.right_quantity) {
        (Some(left), Some(right)) => (left, right),
        _ => return Err("Both split quantities are required.".into()),
    };
    if left_quantity + right_quantity != original_quantity {
        return Err("The split quantities must add up to the original quantity.".into());
    }

    let build_side = |quantity: i64, price: Option<f64>| -> Result<Transaction, String> {
        validate_fields(
            Some(quantity),
            if is_buy { price } else { None },
            if is_buy { original.buy_date.as_ref() } else { None },
            if is_buy { None } else { price },
            if is_buy { None } else { original.sell_date.as_ref() },
        )?;
        let now = timestamp();
        Ok(Transaction {
            uuid: Uuid::new_v4().to_string(),
            create_date: now.clone(),
            modify_date: now,
            quantity: Some(quantity),
            buy_price: if is_buy { round_price(price, &code) } else { None },
            buy_date: if is_buy { original.buy_date.clone() } else { None },
            sell_price: if is_buy { None } else { round_price(price, &code) },
            sell_date: if is_buy { None } else { original.sell_date.clone() },
            note: original.note.clone(),
        })
    };

    let left = build_side(left_quantity, request.left_price)?;
    let right = build_side(right_quantity, request.right_price)?;

    ledger
        .transactions
        .retain(|transaction| transaction.uuid != request.uuid);
    ledger.transactions.push(left.clone());
    ledger.transactions.push(right.clone());

    write_json_file(&path, &ledger)?;
    Ok((left, right))
}

fn is_ledger_event(event: &Event) -> bool {
    matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    ) && event.paths.iter().any(|path| {
        path.extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    })
}

fn create_ledger_watcher(
    app: tauri::AppHandle,
    storage_root: &Path,
    watcher_generation: Arc<AtomicU64>,
    generation: u64,
) -> Result<RecommendedWatcher, String> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        while receiver.recv().is_ok() {
            loop {
                match receiver.recv_timeout(Duration::from_millis(150)) {
                    Ok(()) => {}
                    Err(RecvTimeoutError::Timeout) => {
                        if watcher_generation.load(Ordering::Acquire) == generation {
                            let _ = app.emit(STOCK_LEDGERS_CHANGED_EVENT, ());
                        }
                        break;
                    }
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
        }
    });

    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| match result {
            Ok(event) if is_ledger_event(&event) => {
                let _ = sender.send(());
            }
            Ok(_) => {}
            Err(error) => eprintln!("Stock ledger watcher error: {error}"),
        },
        Config::default(),
    )
    .map_err(|error| format!("Could not create stock ledger watcher: {error}"))?;
    watcher
        .watch(
            ledger_directory(storage_root).as_path(),
            RecursiveMode::NonRecursive,
        )
        .map_err(|error| {
            format!(
                "Could not watch stock ledger directory {}: {error}",
                ledger_directory(storage_root).display()
            )
        })?;
    Ok(watcher)
}

fn default_storage_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .map(|path| path.join("Little V"))
        .map_err(|error| format!("Could not find the current user's Documents directory: {error}"))
}

#[tauri::command]
fn get_data_directory(state: State<'_, StorageState>) -> Result<String, String> {
    state
        .lock()?
        .root
        .clone()
        .into_os_string()
        .into_string()
        .map_err(|path| {
            format!(
                "Data directory is not valid Unicode: {}",
                path.to_string_lossy()
            )
        })
}

#[tauri::command]
fn get_default_data_directory(app: tauri::AppHandle) -> Result<String, String> {
    default_storage_root(&app)?
        .into_os_string()
        .into_string()
        .map_err(|path| {
            format!(
                "Default data directory is not valid Unicode: {}",
                path.to_string_lossy()
            )
        })
}

#[tauri::command]
fn set_data_directory(
    app: tauri::AppHandle,
    state: State<'_, StorageState>,
    directory: String,
) -> Result<String, String> {
    let requested = PathBuf::from(directory.trim());
    if !requested.is_absolute() {
        return Err("Data directory must be an absolute path.".into());
    }
    if !requested.exists() {
        return Err(format!(
            "Data directory does not exist: {}",
            requested.display()
        ));
    }
    if !requested.is_dir() {
        return Err(format!(
            "Data directory path is not a directory: {}",
            requested.display()
        ));
    }
    let root = requested;
    ensure_storage_root(&root)?;

    let mut inner = state.lock()?;
    let next_generation = state.watcher_generation.load(Ordering::Acquire) + 1;
    let watcher = create_ledger_watcher(
        app.clone(),
        &root,
        Arc::clone(&state.watcher_generation),
        next_generation,
    )?;
    state
        .watcher_generation
        .store(next_generation, Ordering::Release);
    inner.root = root.clone();
    inner._watcher = watcher;
    if let Err(error) = app.emit(STOCK_LEDGERS_CHANGED_EVENT, ()) {
        eprintln!("Could not notify the application of the data directory change: {error}");
    }
    if let Err(error) = app.emit(TICKER_STOCKS_CHANGED_EVENT, ()) {
        eprintln!("Could not notify the ticker of the data directory change: {error}");
    }

    root.into_os_string().into_string().map_err(|path| {
        format!(
            "Selected data directory is not valid Unicode: {}",
            path.to_string_lossy()
        )
    })
}

#[tauri::command]
fn load_stock_ledgers(state: State<'_, StorageState>) -> Result<Vec<StockLedger>, String> {
    let inner = state.lock()?;
    load_ledgers_from(&inner.root)
}

#[tauri::command]
fn create_transaction(
    state: State<'_, StorageState>,
    request: CreateTransactionRequest,
) -> Result<Transaction, String> {
    let inner = state.lock()?;
    save_transaction_to(&inner.root, request)
}

#[tauri::command]
fn delete_transaction(
    state: State<'_, StorageState>,
    code: String,
    uuid: String,
) -> Result<(), String> {
    let inner = state.lock()?;
    delete_transaction_from(&inner.root, &code, &uuid)
}

#[tauri::command]
fn update_transaction(
    state: State<'_, StorageState>,
    request: UpdateTransactionRequest,
) -> Result<Transaction, String> {
    let inner = state.lock()?;
    update_transaction_in(&inner.root, request)
}

#[tauri::command]
fn merge_transactions(
    state: State<'_, StorageState>,
    request: MergeTransactionsRequest,
) -> Result<Transaction, String> {
    let inner = state.lock()?;
    merge_transactions_in(&inner.root, request)
}

#[tauri::command]
fn split_transaction(
    state: State<'_, StorageState>,
    request: SplitTransactionRequest,
) -> Result<Vec<Transaction>, String> {
    let inner = state.lock()?;
    let (left, right) = split_transaction_in(&inner.root, request)?;
    Ok(vec![left, right])
}

#[tauri::command]
fn load_ticker_stocks(state: State<'_, StorageState>) -> Result<Vec<TickerStock>, String> {
    let inner = state.lock()?;
    load_ticker_stocks_from(&inner.root)
}

#[tauri::command]
fn save_ticker_stocks(
    app: tauri::AppHandle,
    state: State<'_, StorageState>,
    stocks: Vec<TickerStock>,
) -> Result<(), String> {
    let inner = state.lock()?;
    save_ticker_stocks_to(&inner.root, &stocks)?;
    app.emit(TICKER_STOCKS_CHANGED_EVENT, ())
        .map_err(|error| format!("Could not notify ticker windows: {error}"))
}

#[tauri::command]
fn set_ticker_visibility(app: tauri::AppHandle, visible: bool) -> Result<bool, String> {
    let window = app
        .get_webview_window(TICKER_WINDOW_LABEL)
        .ok_or_else(|| "Ticker window is unavailable.".to_string())?;
    if visible {
        window
            .show()
            .map_err(|error| format!("Could not show ticker window: {error}"))?;
    } else {
        window
            .hide()
            .map_err(|error| format!("Could not hide ticker window: {error}"))?;
    }
    app.emit(TICKER_VISIBILITY_CHANGED_EVENT, visible)
        .map_err(|error| format!("Could not notify ticker visibility: {error}"))?;
    Ok(visible)
}

#[tauri::command]
fn toggle_ticker_visibility(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window(TICKER_WINDOW_LABEL)
        .ok_or_else(|| "Ticker window is unavailable.".to_string())?;
    let visible = !window
        .is_visible()
        .map_err(|error| format!("Could not read ticker visibility: {error}"))?;
    set_ticker_visibility(app, visible)
}

#[tauri::command]
fn set_ticker_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    let window = app
        .get_webview_window(TICKER_WINDOW_LABEL)
        .ok_or_else(|| "Ticker window is unavailable.".to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| format!("Could not position ticker window: {error}"))
}

#[tauri::command]
fn start_ticker_dragging(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(TICKER_WINDOW_LABEL)
        .ok_or_else(|| "Ticker window is unavailable.".to_string())?;
    window
        .start_dragging()
        .map_err(|error| format!("Could not drag ticker window: {error}"))
}

#[tauri::command]
fn resize_ticker_window(app: tauri::AppHandle, width: f64, height: f64) -> Result<(), String> {
    let window = app
        .get_webview_window(TICKER_WINDOW_LABEL)
        .ok_or_else(|| "Ticker window is unavailable.".to_string())?;
    window
        .set_size(tauri::LogicalSize::new(
            width.clamp(1.0, 1000.0),
            height.clamp(1.0, 1200.0),
        ))
        .map_err(|error| format!("Could not resize ticker window: {error}"))
}

#[tauri::command]
fn set_ticker_opacity(app: tauri::AppHandle, opacity: f64) -> Result<(), String> {
    let clamped = opacity.clamp(10.0, 100.0);
    app.emit(TICKER_OPACITY_CHANGED_EVENT, clamped)
        .map_err(|error| format!("Could not notify ticker opacity: {error}"))
}

#[tauri::command]
fn get_cached_stock_quotes(
    state: State<'_, QuoteCacheState>,
) -> Result<HashMap<String, StockQuote>, String> {
    state
        .0
        .lock()
        .map(|cache| cache.clone())
        .map_err(|_| "Could not access the stock quote cache.".to_string())
}

#[tauri::command]
fn cache_stock_quotes(
    app: tauri::AppHandle,
    state: State<'_, QuoteCacheState>,
    quotes: HashMap<String, StockQuote>,
) -> Result<(), String> {
    let cached = {
        let mut cache = state
            .0
            .lock()
            .map_err(|_| "Could not access the stock quote cache.".to_string())?;
        cache.extend(quotes);
        cache.clone()
    };
    app.emit(STOCK_QUOTES_UPDATED_EVENT, cached)
        .map_err(|error| format!("Could not publish stock quotes: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn base_request() -> CreateTransactionRequest {
        CreateTransactionRequest {
            name: "Example Corp".into(),
            code: "EXAMPLE".into(),
            quantity: Some(100),
            buy_price: Some(10.0),
            buy_date: None,
            sell_price: None,
            sell_date: None,
            note: None,
        }
    }

    #[test]
    fn saves_a_buy_only_transaction() {
        let directory = tempdir().unwrap();
        let transaction = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                buy_price: Some(10.0),
                buy_date: Some("2026-09-04".into()),
                ..base_request()
            },
        )
        .unwrap();

        assert_eq!(transaction.buy_price, Some(10.0));
        assert_eq!(transaction.sell_price, None);

        let ledger = load_ledgers_from(directory.path()).unwrap().pop().unwrap();
        assert_eq!(ledger.transactions.len(), 1);
    }

    #[test]
    fn saves_a_sell_only_transaction() {
        let directory = tempdir().unwrap();
        let transaction = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                buy_price: None,
                sell_price: Some(12.0),
                sell_date: Some("2026-09-05".into()),
                ..base_request()
            },
        )
        .unwrap();

        assert_eq!(transaction.sell_price, Some(12.0));
        assert_eq!(transaction.buy_price, None);
    }

    #[test]
    fn saves_a_transaction_with_both_buy_and_sell() {
        let directory = tempdir().unwrap();
        let transaction = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                buy_price: Some(10.0),
                buy_date: Some("2026-09-04".into()),
                sell_price: Some(12.0),
                sell_date: Some("2026-09-05".into()),
                ..base_request()
            },
        )
        .unwrap();

        assert_eq!(transaction.buy_price, Some(10.0));
        assert_eq!(transaction.sell_price, Some(12.0));
    }

    #[test]
    fn rejects_a_transaction_without_a_buy_or_sell_price() {
        let directory = tempdir().unwrap();
        let result = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                quantity: None,
                buy_price: None,
                ..base_request()
            },
        );
        assert!(result.unwrap_err().contains("buy price or sell price"));
    }

    #[test]
    fn saves_a_trimmed_note() {
        let directory = tempdir().unwrap();
        let transaction = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                note: Some("  Remember to review earnings.  ".into()),
                ..base_request()
            },
        )
        .unwrap();

        assert_eq!(
            transaction.note,
            Some("Remember to review earnings.".into())
        );
    }

    #[test]
    fn treats_a_blank_note_as_absent() {
        let directory = tempdir().unwrap();
        let transaction = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                note: Some("   ".into()),
                ..base_request()
            },
        )
        .unwrap();

        assert_eq!(transaction.note, None);
    }

    #[test]
    fn saves_a_buy_price_without_a_buy_date() {
        let directory = tempdir().unwrap();
        let transaction = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                buy_price: Some(10.0),
                ..base_request()
            },
        )
        .unwrap();

        assert_eq!(transaction.buy_price, Some(10.0));
        assert_eq!(transaction.buy_date, None);
    }

    #[test]
    fn rejects_a_sell_date_without_a_sell_price() {
        let directory = tempdir().unwrap();
        let result = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                sell_date: Some("2026-09-05".into()),
                ..base_request()
            },
        );
        assert!(result.unwrap_err().contains("Sell price is required"));
    }

    #[test]
    fn rejects_a_buy_date_without_a_buy_price() {
        let directory = tempdir().unwrap();
        let result = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                buy_price: None,
                buy_date: Some("2026-09-05".into()),
                ..base_request()
            },
        );
        assert!(result.unwrap_err().contains("Buy price is required"));
    }

    #[test]
    fn rounds_a_stock_price_to_two_decimal_places() {
        let directory = tempdir().unwrap();
        let transaction = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                code: "SH600000".into(),
                buy_price: Some(10.5678),
                sell_price: Some(12.006),
                ..base_request()
            },
        )
        .unwrap();

        assert_eq!(transaction.buy_price, Some(10.57));
        assert_eq!(transaction.sell_price, Some(12.01));
    }

    #[test]
    fn keeps_three_decimal_places_for_an_etf_price() {
        let directory = tempdir().unwrap();
        let transaction = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                code: "SH510300".into(),
                buy_price: Some(3.45678),
                ..base_request()
            },
        )
        .unwrap();

        assert_eq!(transaction.buy_price, Some(3.457));
    }

    #[test]
    fn rejects_a_quantity_that_is_not_a_multiple_of_100() {
        let directory = tempdir().unwrap();
        let result = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                quantity: Some(150),
                buy_price: Some(10.0),
                buy_date: Some("2026-09-04".into()),
                ..base_request()
            },
        );
        assert!(result.unwrap_err().contains("multiple of 100"));
    }

    #[test]
    fn saves_an_integer_quantity_without_a_fractional_part() {
        let directory = tempdir().unwrap();
        let transaction = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                quantity: Some(1000),
                ..base_request()
            },
        )
        .unwrap();

        assert_eq!(transaction.quantity, Some(1000));

        let ledger = load_ledgers_from(directory.path()).unwrap().pop().unwrap();
        let saved =
            fs::read_to_string(stock_path(directory.path(), &ledger.code).unwrap()).unwrap();
        assert!(saved.contains("\"quantity\": 1000") || saved.contains("\"quantity\":1000"));
        assert!(!saved.contains("1000.0"));
    }

    #[test]
    fn deletes_a_transaction_by_uuid() {
        let directory = tempdir().unwrap();
        let first = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                buy_price: Some(10.0),
                buy_date: Some("2026-09-04".into()),
                ..base_request()
            },
        )
        .unwrap();
        save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                sell_price: Some(12.0),
                sell_date: Some("2026-09-05".into()),
                ..base_request()
            },
        )
        .unwrap();

        delete_transaction_from(directory.path(), "EXAMPLE", &first.uuid).unwrap();

        let ledger = load_ledgers_from(directory.path()).unwrap().pop().unwrap();
        assert_eq!(ledger.transactions.len(), 1);
        assert!(ledger
            .transactions
            .iter()
            .all(|transaction| transaction.uuid != first.uuid));
    }

    #[test]
    fn deletes_the_ledger_file_with_its_final_transaction() {
        let directory = tempdir().unwrap();
        let transaction = save_transaction_to(directory.path(), base_request()).unwrap();
        let path = stock_path(directory.path(), "EXAMPLE").unwrap();

        delete_transaction_from(directory.path(), "EXAMPLE", &transaction.uuid).unwrap();

        assert!(!path.exists());
        assert!(load_ledgers_from(directory.path()).unwrap().is_empty());
    }

    #[test]
    fn rejects_deleting_a_transaction_that_does_not_exist() {
        let directory = tempdir().unwrap();
        save_transaction_to(directory.path(), base_request()).unwrap();

        let result = delete_transaction_from(directory.path(), "EXAMPLE", "missing-uuid");
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn rejects_deleting_from_a_ledger_that_does_not_exist() {
        let directory = tempdir().unwrap();
        let result = delete_transaction_from(directory.path(), "MISSING", "some-uuid");
        assert!(result.is_err());
    }

    fn base_update(code: &str, uuid: &str) -> UpdateTransactionRequest {
        UpdateTransactionRequest {
            code: code.into(),
            uuid: uuid.into(),
            quantity: Some(100),
            buy_price: Some(10.0),
            buy_date: None,
            sell_price: None,
            sell_date: None,
            note: None,
        }
    }

    #[test]
    fn updates_a_transaction_by_uuid() {
        let directory = tempdir().unwrap();
        let created = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                buy_price: Some(10.0),
                buy_date: Some("2026-09-04".into()),
                ..base_request()
            },
        )
        .unwrap();

        let updated = update_transaction_in(
            directory.path(),
            UpdateTransactionRequest {
                quantity: Some(200),
                buy_price: Some(11.0),
                buy_date: Some("2026-09-06".into()),
                sell_price: Some(13.0),
                sell_date: Some("2026-09-07".into()),
                note: Some("Reviewed".into()),
                ..base_update("EXAMPLE", &created.uuid)
            },
        )
        .unwrap();

        assert_eq!(updated.uuid, created.uuid);
        assert_eq!(updated.create_date, created.create_date);
        assert_eq!(updated.quantity, Some(200));
        assert_eq!(updated.buy_price, Some(11.0));
        assert_eq!(updated.buy_date, Some("2026-09-06".into()));
        assert_eq!(updated.sell_price, Some(13.0));
        assert_eq!(updated.sell_date, Some("2026-09-07".into()));
        assert_eq!(updated.note, Some("Reviewed".into()));

        let ledger = load_ledgers_from(directory.path()).unwrap().pop().unwrap();
        assert_eq!(ledger.transactions.len(), 1);
        assert_eq!(ledger.transactions[0].quantity, Some(200));
    }

    #[test]
    fn rejects_updating_a_transaction_without_a_buy_or_sell_price() {
        let directory = tempdir().unwrap();
        let created = save_transaction_to(directory.path(), base_request()).unwrap();
        let result = update_transaction_in(
            directory.path(),
            UpdateTransactionRequest {
                buy_price: None,
                ..base_update("EXAMPLE", &created.uuid)
            },
        );
        assert!(result.unwrap_err().contains("buy price or sell price"));
    }

    #[test]
    fn rounds_a_stock_price_to_two_decimal_places_when_updating() {
        let directory = tempdir().unwrap();
        let created = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                code: "SH600000".into(),
                ..base_request()
            },
        )
        .unwrap();

        let updated = update_transaction_in(
            directory.path(),
            UpdateTransactionRequest {
                buy_price: Some(10.5678),
                ..base_update("SH600000", &created.uuid)
            },
        )
        .unwrap();

        assert_eq!(updated.buy_price, Some(10.57));
    }

    #[test]
    fn rejects_updating_a_transaction_with_an_invalid_quantity() {
        let directory = tempdir().unwrap();
        let created = save_transaction_to(directory.path(), base_request()).unwrap();

        let result = update_transaction_in(
            directory.path(),
            UpdateTransactionRequest {
                quantity: Some(150),
                ..base_update("EXAMPLE", &created.uuid)
            },
        );
        assert!(result.unwrap_err().contains("multiple of 100"));
    }

    #[test]
    fn rejects_updating_a_transaction_that_does_not_exist() {
        let directory = tempdir().unwrap();
        save_transaction_to(directory.path(), base_request()).unwrap();

        let result =
            update_transaction_in(directory.path(), base_update("EXAMPLE", "missing-uuid"));
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn rejects_updating_from_a_ledger_that_does_not_exist() {
        let directory = tempdir().unwrap();
        let result = update_transaction_in(directory.path(), base_update("MISSING", "some-uuid"));
        assert!(result.is_err());
    }

    #[test]
    fn merges_two_open_buys_into_one_weighted_average_transaction() {
        let directory = tempdir().unwrap();
        let first = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                quantity: Some(100),
                buy_price: Some(10.0),
                buy_date: Some("2026-09-01".into()),
                note: Some("first".into()),
                ..base_request()
            },
        )
        .unwrap();
        let second = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                quantity: Some(200),
                buy_price: Some(13.0),
                buy_date: Some("2026-09-05".into()),
                note: Some("second".into()),
                ..base_request()
            },
        )
        .unwrap();

        let merged = merge_transactions_in(
            directory.path(),
            MergeTransactionsRequest {
                code: "EXAMPLE".into(),
                uuids: vec![first.uuid.clone(), second.uuid.clone()],
                quantity: Some(300),
                buy_price: Some(12.0),
                buy_date: Some("2026-09-05".into()),
                sell_price: None,
                sell_date: None,
                note: Some("first\nsecond".into()),
            },
        )
        .unwrap();

        assert_eq!(merged.quantity, Some(300));
        assert_eq!(merged.buy_price, Some(12.0));
        assert_eq!(merged.buy_date, Some("2026-09-05".into()));
        assert_eq!(merged.note, Some("first\nsecond".into()));

        let ledger = load_ledgers_from(directory.path()).unwrap().pop().unwrap();
        assert_eq!(ledger.transactions.len(), 1);
        assert_eq!(ledger.transactions[0].uuid, merged.uuid);
    }

    #[test]
    fn rejects_merging_fewer_than_two_transactions() {
        let directory = tempdir().unwrap();
        let created = save_transaction_to(directory.path(), base_request()).unwrap();

        let result = merge_transactions_in(
            directory.path(),
            MergeTransactionsRequest {
                code: "EXAMPLE".into(),
                uuids: vec![created.uuid],
                quantity: Some(100),
                buy_price: Some(10.0),
                buy_date: None,
                sell_price: None,
                sell_date: None,
                note: None,
            },
        );
        assert!(result.unwrap_err().contains("at least two"));
    }

    #[test]
    fn rejects_merging_a_transaction_that_does_not_exist() {
        let directory = tempdir().unwrap();
        let created = save_transaction_to(directory.path(), base_request()).unwrap();

        let result = merge_transactions_in(
            directory.path(),
            MergeTransactionsRequest {
                code: "EXAMPLE".into(),
                uuids: vec![created.uuid, "missing-uuid".into()],
                quantity: Some(100),
                buy_price: Some(10.0),
                buy_date: None,
                sell_price: None,
                sell_date: None,
                note: None,
            },
        );
        assert!(result.unwrap_err().contains("not be found"));
    }

    #[test]
    fn splits_an_open_buy_into_two_transactions_conserving_total_value() {
        let directory = tempdir().unwrap();
        let created = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                quantity: Some(300),
                buy_price: Some(10.0),
                buy_date: Some("2026-09-01".into()),
                note: Some("original".into()),
                ..base_request()
            },
        )
        .unwrap();

        let (left, right) = split_transaction_in(
            directory.path(),
            SplitTransactionRequest {
                code: "EXAMPLE".into(),
                uuid: created.uuid.clone(),
                left_quantity: Some(100),
                left_price: Some(12.0),
                right_quantity: Some(200),
                right_price: Some(9.0),
            },
        )
        .unwrap();

        assert_eq!(left.quantity, Some(100));
        assert_eq!(left.buy_price, Some(12.0));
        assert_eq!(left.buy_date, Some("2026-09-01".into()));
        assert_eq!(left.note, Some("original".into()));
        assert_eq!(right.quantity, Some(200));
        assert_eq!(right.buy_price, Some(9.0));
        assert_eq!(right.buy_date, Some("2026-09-01".into()));
        assert_eq!(right.note, Some("original".into()));

        let ledger = load_ledgers_from(directory.path()).unwrap().pop().unwrap();
        assert_eq!(ledger.transactions.len(), 2);
        assert!(ledger
            .transactions
            .iter()
            .all(|transaction| transaction.uuid != created.uuid));
    }

    #[test]
    fn rejects_splitting_when_quantities_do_not_add_up_to_the_original() {
        let directory = tempdir().unwrap();
        let created = save_transaction_to(
            directory.path(),
            CreateTransactionRequest {
                quantity: Some(300),
                buy_price: Some(10.0),
                ..base_request()
            },
        )
        .unwrap();

        let result = split_transaction_in(
            directory.path(),
            SplitTransactionRequest {
                code: "EXAMPLE".into(),
                uuid: created.uuid,
                left_quantity: Some(100),
                left_price: Some(12.0),
                right_quantity: Some(100),
                right_price: Some(9.0),
            },
        );
        assert!(result.unwrap_err().contains("add up"));
    }

    #[test]
    fn rejects_splitting_a_transaction_that_does_not_exist() {
        let directory = tempdir().unwrap();
        save_transaction_to(directory.path(), base_request()).unwrap();

        let result = split_transaction_in(
            directory.path(),
            SplitTransactionRequest {
                code: "EXAMPLE".into(),
                uuid: "missing-uuid".into(),
                left_quantity: Some(50),
                left_price: Some(10.0),
                right_quantity: Some(50),
                right_price: Some(10.0),
            },
        );
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn saves_and_loads_ticker_stocks_as_json_lines_in_order() {
        let directory = tempdir().unwrap();
        let stocks = vec![
            TickerStock {
                code: "SH510300".into(),
                name: "沪深300ETF".into(),
                lower: "3.75".into(),
                upper: "4.25".into(),
            },
            TickerStock {
                code: "SZ000001".into(),
                name: "Example Bank".into(),
                lower: "".into(),
                upper: "12".into(),
            },
        ];

        save_ticker_stocks_to(directory.path(), &stocks).unwrap();

        assert_eq!(load_ticker_stocks_from(directory.path()).unwrap(), stocks);
        let content = fs::read_to_string(directory.path().join("ticker.jsonl")).unwrap();
        assert_eq!(content.lines().count(), 2);
        assert!(content.lines().next().unwrap().contains("\"code\":\"SH510300\""));

        let updated = vec![TickerStock {
            code: "SZ000001".into(),
            name: "Example Bank".into(),
            lower: "7.5".into(),
            upper: "12".into(),
        }];
        save_ticker_stocks_to(directory.path(), &updated).unwrap();
        assert_eq!(load_ticker_stocks_from(directory.path()).unwrap(), updated);
    }

    #[test]
    fn rejects_duplicate_ticker_stock_codes_case_insensitively() {
        let directory = tempdir().unwrap();
        let result = save_ticker_stocks_to(
            directory.path(),
            &[
                TickerStock {
                    code: "SH600000".into(),
                    name: "First".into(),
                    lower: "".into(),
                    upper: "".into(),
                },
                TickerStock {
                    code: "sh600000".into(),
                    name: "Second".into(),
                    lower: "".into(),
                    upper: "".into(),
                },
            ],
        );

        assert!(result.unwrap_err().contains("duplicate"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let ticker_window = WebviewWindowBuilder::new(
                app,
                TICKER_WINDOW_LABEL,
                WebviewUrl::App("index.html?view=ticker".into()),
            )
            .title("Little V Ticker")
            .inner_size(1.0, 1.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .visible(false)
            .build()?;
            let ticker_app = app_handle.clone();
            ticker_window.on_window_event(move |event| {
                if let WindowEvent::Moved(PhysicalPosition { x, y }) = event {
                    if let Err(error) = ticker_app.emit(
                        TICKER_POSITION_CHANGED_EVENT,
                        TickerPosition { x: *x, y: *y },
                    ) {
                        eprintln!("Could not notify ticker position: {error}");
                    }
                }
            });
            if let Some(main_window) = app.get_webview_window("main") {
                let quit_app = app_handle.clone();
                main_window.on_window_event(move |event| {
                    // The ticker window is only hidden while the app runs, so closing
                    // the main window would otherwise leave the process (and the
                    // floating ticker) running with no way to reopen the main window.
                    if let WindowEvent::CloseRequested { .. } = event {
                        quit_app.exit(0);
                    }
                });
            }
            let root = default_storage_root(&app_handle)
                .and_then(|root| {
                    ensure_storage_root(&root)?;
                    Ok(root)
                })
                .map_err(std::io::Error::other)?;
            let watcher_generation = Arc::new(AtomicU64::new(1));
            let watcher =
                create_ledger_watcher(app_handle, &root, Arc::clone(&watcher_generation), 1)
                    .map_err(std::io::Error::other)?;
            app.manage(StorageState {
                inner: Mutex::new(StorageInner {
                    root,
                    _watcher: watcher,
                }),
                watcher_generation,
            });
            app.manage(QuoteCacheState(Mutex::new(HashMap::new())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_data_directory,
            get_default_data_directory,
            set_data_directory,
            load_stock_ledgers,
            create_transaction,
            delete_transaction,
            update_transaction,
            merge_transactions,
            split_transaction,
            load_ticker_stocks,
            save_ticker_stocks,
            set_ticker_visibility,
            toggle_ticker_visibility,
            set_ticker_position,
            start_ticker_dragging,
            resize_ticker_window,
            set_ticker_opacity,
            get_cached_stock_quotes,
            cache_stock_quotes
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
