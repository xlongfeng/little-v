import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const { invoke, listen, open, searchStocks, fetchQuotes } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  open: vi.fn(),
  searchStocks: vi.fn(),
  fetchQuotes: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));
vi.mock("./stockApi", () => ({ searchStocks, fetchQuotes }));

const today = () => new Date().toISOString().slice(0, 10);

describe("App", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  beforeEach(() => {
    window.localStorage.clear();
    invoke.mockReset();
    listen.mockReset();
    open.mockReset();
    searchStocks.mockReset();
    fetchQuotes.mockReset();
    fetchQuotes.mockResolvedValue({});
    listen.mockResolvedValue(vi.fn());
    open.mockResolvedValue(null);
    const ledgers = [
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          {
            uuid: "buy",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 10,
            buyDate: "2026-09-01",
          },
        ],
      },
    ];
    invoke.mockImplementation((command, args) => {
      if (command === "load_stock_ledgers") {
        return Promise.resolve(ledgers);
      }
      if (command === "load_ticker_stocks") {
        return Promise.resolve([]);
      }
      if (command === "get_data_directory" || command === "get_default_data_directory") {
        return Promise.resolve("C:\\Users\\Example\\Documents\\Little V");
      }
      if (command === "set_data_directory") {
        return Promise.resolve((args as { directory: string }).directory);
      }
      return Promise.resolve(undefined);
    });
  });

  it("shows the app version in a smaller font appended to the About dialog title", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "About" }));

    const dialog = screen.getByRole("dialog");
    const versionTag = within(dialog).getByText(/^Version \d+\.\d+\.\d+$/);
    expect(versionTag).toHaveClass("version-tag");
    expect(within(dialog).getByRole("heading")).toHaveTextContent(/^About Little V Version \d+\.\d+\.\d+$/);
    expect(within(dialog).getByText("A local stock transaction ledger.")).toBeInTheDocument();
  });

  it("opens the embedded Ticker dialog and toggles the ticker window from the far-right menu button", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ticker" }));
    expect(screen.getByRole("dialog", { name: "Ticker" })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("load_ticker_stocks");
    expect(invoke).not.toHaveBeenCalledWith("open_ticker_settings");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Ticker" })).not.toBeInTheDocument();

    invoke.mockResolvedValueOnce(true);
    const toggle = screen.getByRole("button", { name: "Show ticker" });
    await user.click(toggle);

    expect(invoke).toHaveBeenCalledWith("toggle_ticker_visibility");
    expect(window.localStorage.getItem("littlev-ticker-visible")).toBe("true");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("defaults to Chinese when the OS/browser language is Chinese", async () => {
    const languageSpy = vi.spyOn(window.navigator, "language", "get").mockReturnValue("zh-CN");
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "新建" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关于" })).toBeInTheDocument();

    languageSpy.mockRestore();
  });

  it("lets the user switch language in Settings and persists the choice", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.selectOptions(screen.getByLabelText("Language"), "zh_cn");
    expect(screen.getByRole("button", { name: "新建" })).toBeInTheDocument();
    expect(window.localStorage.getItem("littlev-language")).toBeNull();
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(screen.getByRole("button", { name: "新建" })).toBeInTheDocument();
    expect(window.localStorage.getItem("littlev-language")).toBe("zh_cn");
  });

  it("offers a Default option that reverts to following the OS language", async () => {
    const user = userEvent.setup();
    const languageSpy = vi.spyOn(window.navigator, "language", "get").mockReturnValue("zh-CN");
    try {
      render(<App />);
      expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

      // OS is Chinese, so the app should start in Chinese with "system" preselected.
      await user.click(screen.getByRole("button", { name: "设置" }));
      expect(screen.getByLabelText("语言")).toHaveValue("system");

      // Explicitly switch to English, then save.
      await user.selectOptions(screen.getByLabelText("语言"), "en");
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
      expect(window.localStorage.getItem("littlev-language")).toBe("en");

      // Reopen Settings, choose Default, then save; it should revert to the OS language.
      await user.click(screen.getByRole("button", { name: "Settings" }));
      await user.click(screen.getByRole("button", { name: "Default" }));
      await user.click(screen.getByRole("button", { name: "保存" }));
      expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
      expect(window.localStorage.getItem("littlev-language")).toBeNull();
    } finally {
      languageSpy.mockRestore();
    }
  });

  it("filters the combined ledger table to a single selected stock name", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          {
            uuid: "buy",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 10,
            buyDate: "2026-09-01",
          },
        ],
      },
      {
        code: "SZ000001",
        name: "Second Bank",
        transactions: [
          {
            uuid: "buy-2",
            createDate: "2",
            modifyDate: "2",
            quantity: 100,
            buyPrice: 10,
            buyDate: "2026-09-01",
          },
        ],
      },
    ]);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();
    expect(screen.getByText("Second Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Names"), "Example Bank");

    expect(screen.getByRole("row", { name: /Example Bank/ })).toBeInTheDocument();
    expect(screen.queryByText("Second Bank", { selector: ".stock-name" })).not.toBeInTheDocument();
  });

  it("shows a stock summary in the status bar for the selected Names filter, counting only valid open transactions", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          { uuid: "open-buy-1", createDate: "1", modifyDate: "1", quantity: 100, buyPrice: 10, buyDate: "2026-09-01" },
          { uuid: "open-buy-2", createDate: "2", modifyDate: "2", quantity: 200, buyPrice: 12, buyDate: "2026-09-02" },
          { uuid: "undated-buy", createDate: "3", modifyDate: "3", quantity: 50, buyPrice: 9 },
          { uuid: "open-sell", createDate: "4", modifyDate: "4", quantity: 30, sellPrice: 15, sellDate: "2026-09-03" },
          { uuid: "closed", createDate: "5", modifyDate: "5", quantity: 100, buyPrice: 8, buyDate: "2026-09-01", sellPrice: 14, sellDate: "2026-09-02" },
        ],
      },
    ]);
    fetchQuotes.mockResolvedValue({
      SH600000: { code: "SH600000", now: 11, yesterday: 10, percent: 0.1 },
    });
    render(<App />);
    expect((await screen.findAllByText("Example Bank", { selector: ".stock-name" })).length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText("Names"), "Example Bank");

    const statusBar = document.querySelector(".status-bar") as HTMLElement;
    expect(within(statusBar).getByText("11.00 / +10.00%")).toHaveClass("price-gain");
    // Avg cost: (100*10 + 200*12) / 300 = 11.33; change vs current price 11: (11-11.33)/11.33 = -2.94%.
    expect(within(statusBar).getByText("Avg cost: 11.33")).toBeInTheDocument();
    expect(within(statusBar).getByText("(-2.94%)")).toHaveClass("price-loss");
    // Net quantity: 300 open-buy total minus 30 open-sell total = 270.
    expect(within(statusBar).getByText("Qty: 270")).toBeInTheDocument();
    expect(within(statusBar).getByText("Value: 2970.00")).toBeInTheDocument();
    // P/L: buys (11-10)*100 + (11-12)*200 = -100, plus sell (15-11)*30 = 120 => 20.00
    expect(within(statusBar).getByText("P/L: 20.00")).toBeInTheDocument();
  });

  it("shows a comment indicator next to the stock name with the note text as a tooltip", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          {
            uuid: "buy",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 10,
            buyDate: "2026-09-01",
            note: "Watch earnings guidance",
          },
        ],
      },
    ]);
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    const indicator = screen.getByLabelText("Note: Watch earnings guidance");
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveAttribute("title", "Watch earnings guidance");
  });

  it("does not show a comment indicator when a transaction has no note", async () => {
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    expect(screen.queryByText("💬")).not.toBeInTheDocument();
  });

  it("deletes a transaction when the delete icon is clicked and confirmed in the dialog", async () => {
    const user = userEvent.setup();
    const ledgers = [
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          {
            uuid: "buy",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 10,
            buyDate: "2026-09-01",
          },
        ],
      },
    ];
    invoke.mockImplementation((command: string) => {
      if (command === "delete_transaction") {
        return Promise.resolve();
      }
      return Promise.resolve(ledgers);
    });
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete transaction" }));
    const dialog = screen.getByRole("dialog", { name: "Delete transaction" });
    expect(within(dialog).getByText(/Example Bank/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(invoke).toHaveBeenCalledWith("delete_transaction", { code: "SH600000", uuid: "buy" });
    expect(screen.queryByRole("dialog", { name: "Delete transaction" })).not.toBeInTheDocument();
  });

  it("does not delete a transaction when the confirmation dialog is cancelled", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete transaction" }));
    const dialog = screen.getByRole("dialog", { name: "Delete transaction" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Delete transaction" })).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("delete_transaction", expect.anything());
  });

  it("shows an error inside the delete dialog when deleting a transaction fails", async () => {
    const user = userEvent.setup();
    const ledgers = [
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          {
            uuid: "buy",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 10,
            buyDate: "2026-09-01",
          },
        ],
      },
    ];
    invoke.mockImplementation((command: string) => {
      if (command === "delete_transaction") {
        return Promise.reject(new Error("Transaction not found."));
      }
      return Promise.resolve(ledgers);
    });
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete transaction" }));
    const dialog = screen.getByRole("dialog", { name: "Delete transaction" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await within(dialog).findByText(/Could not delete transaction/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Delete transaction" })).toBeInTheDocument();
  });

  it("opens a pre-filled edit dialog with a locked stock field when a row is double-clicked", async () => {
    const user = userEvent.setup();
    render(<App />);
    const row = (await screen.findByText("Example Bank", { selector: ".stock-name" })).closest("tr");
    expect(row).not.toBeNull();

    await user.dblClick(row as HTMLElement);

    expect(screen.getByRole("heading", { name: "Edit transaction" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Stock" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Stock" })).toHaveValue("Example Bank (600000)");
    expect(screen.getByLabelText("Quantity")).toHaveValue(100);
    expect(screen.getByLabelText("Buy price")).toHaveValue(10);
    expect(screen.getByLabelText("Buy date")).toHaveValue("2026-09-01");
  });

  it("displays table dates as relative milestones and shows the stored date on hover", async () => {
    const dateText = (date: Date) => [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysAgo = (days: number) => {
      const date = new Date(today);
      date.setDate(date.getDate() - days);
      return date;
    };
    const monthsAgo = (months: number) => {
      const date = new Date(today);
      date.setMonth(date.getMonth() - months);
      return date;
    };
    const dates = [
      [today, "today"],
      [daysAgo(1), "1 day ago"],
      [daysAgo(2), "2 days ago"],
      [daysAgo(3), "3 days ago"],
      [daysAgo(6), "3 days ago"],
      [daysAgo(7), "1 week ago"],
      [daysAgo(13), "1 week ago"],
      [daysAgo(14), "2 weeks ago"],
      [daysAgo(20), "2 weeks ago"],
      [monthsAgo(1), "1 month ago"],
      [monthsAgo(2), "2 months ago"],
      [monthsAgo(3), "3 months ago"],
      [monthsAgo(6), "6 months ago"],
      [monthsAgo(12), "1 year ago"],
    ] as const;
    const oneYearDate = dateText(monthsAgo(13));
    const olderDate = dateText(monthsAgo(25));
    invoke.mockResolvedValue([{
      code: "SH600000",
      name: "Example Bank",
      transactions: [
        ...dates.map(([date], index) => ({
          uuid: `relative-${index}`,
          createDate: "1",
          modifyDate: "1",
          buyDate: dateText(date),
        })),
        { uuid: "one-year", createDate: "1", modifyDate: "1", buyDate: oneYearDate },
        { uuid: "older", createDate: "1", modifyDate: "1", buyDate: olderDate },
      ],
    }]);
    render(<App />);

    for (const [date, label] of dates) {
      const cell = await screen.findByTitle(dateText(date));
      expect(cell).toHaveTextContent(label);
      expect(cell).toHaveClass("table-date");
    }
    expect(screen.getByTitle(oneYearDate)).toHaveTextContent("1 year ago");
    expect(screen.getByTitle(olderDate)).toHaveTextContent(olderDate);
  });

  it("shows the selected stock's live quote after the combobox in create and edit dialogs", async () => {
    const user = userEvent.setup();
    fetchQuotes.mockResolvedValue({
      SH600000: { code: "SH600000", now: 10.42, yesterday: 9, percent: 0.1578 },
    });
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();
    await waitFor(() => expect(fetchQuotes).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "New" }));
    await user.click(screen.getByRole("button", { name: "Show existing stocks" }));
    await user.click(screen.getByRole("button", { name: "Example Bank (600000)" }));
    const createQuote = await screen.findByText("10.42 / +15.78%");
    expect(createQuote).toHaveClass("stock-current-quote");
    expect(createQuote.closest(".stock-combobox")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const row = screen.getByText("Example Bank", { selector: ".stock-name" }).closest("tr") as HTMLElement;
    await user.dblClick(row);
    expect(screen.getByText("10.42 / +15.78%").closest(".stock-combobox")).not.toBeNull();
  });

  it("saves an edited transaction and reloads the table", async () => {
    const user = userEvent.setup();
    invoke.mockImplementation((command: string) => {
      if (command === "update_transaction") {
        return Promise.resolve({});
      }
      return Promise.resolve([
        {
          code: "SH600000",
          name: "Example Bank",
          transactions: [
            {
              uuid: "buy",
              createDate: "1",
              modifyDate: "1",
              quantity: 100,
              buyPrice: 10,
              buyDate: "2026-09-01",
            },
          ],
        },
      ]);
    });
    render(<App />);
    const row = (await screen.findByText("Example Bank", { selector: ".stock-name" })).closest("tr");

    await user.dblClick(row as HTMLElement);
    expect(screen.getByRole("heading", { name: "Edit transaction" })).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Buy price"));
    await user.type(screen.getByLabelText("Buy price"), "12");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(invoke).toHaveBeenCalledWith("update_transaction", {
      request: {
        code: "SH600000",
        uuid: "buy",
        quantity: 100,
        buyPrice: 12,
        buyDate: "2026-09-01",
        sellPrice: null,
        sellDate: null,
        note: null,
      },
    });
    expect(screen.queryByRole("heading", { name: "Edit transaction" })).not.toBeInTheDocument();
  });

  it("does not call update_transaction when the edit dialog is cancelled", async () => {
    const user = userEvent.setup();
    render(<App />);
    const row = (await screen.findByText("Example Bank", { selector: ".stock-name" })).closest("tr");

    await user.dblClick(row as HTMLElement);
    expect(screen.getByRole("heading", { name: "Edit transaction" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("heading", { name: "Edit transaction" })).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("update_transaction", expect.anything());
  });

  it("shows every stock again when All is selected in the Names filter", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          {
            uuid: "buy",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 10,
            buyDate: "2026-09-01",
          },
        ],
      },
      {
        code: "SZ000001",
        name: "Second Bank",
        transactions: [
          {
            uuid: "buy-2",
            createDate: "2",
            modifyDate: "2",
            quantity: 100,
            buyPrice: 10,
            buyDate: "2026-09-01",
          },
        ],
      },
    ]);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Names"), "Example Bank");
    expect(screen.queryByText("Second Bank", { selector: ".stock-name" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Names"), "All");
    expect(screen.getByRole("row", { name: /Example Bank/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Second Bank/ })).toBeInTheDocument();
  });

  it("shows three decimal places for ETF and LOF prices, and two for ordinary stocks", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          {
            uuid: "stock-buy",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 10.5,
            buyDate: "2026-09-01",
          },
        ],
      },
      {
        code: "SH510300",
        name: "Example ETF",
        transactions: [
          {
            uuid: "etf-buy",
            createDate: "2",
            modifyDate: "2",
            quantity: 100,
            buyPrice: 3.456,
            buyDate: "2026-09-02",
          },
        ],
      },
    ]);
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    expect(screen.getByText("10.50")).toBeInTheDocument();
    expect(screen.getByText("3.456")).toBeInTheDocument();
  });

  it("omits ETF and LOF from displayed names and shows full name, code, and quote on hover", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH510300",
        name: "Example ETF",
        transactions: [{ uuid: "etf", createDate: "1", modifyDate: "1" }],
      },
    ]);
    fetchQuotes.mockResolvedValue({
      SH510300: { code: "SH510300", now: 3.456, yesterday: 3.4, percent: 0.0165 },
    });
    render(<App />);

    const name = await screen.findByText("Example", { selector: ".stock-name" });
    expect(screen.queryByText("Example ETF", { selector: ".stock-name" })).not.toBeInTheDocument();

    fireEvent.mouseEnter(name);
    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).getByText("Example ETF")).toBeInTheDocument();
    expect(within(tooltip).getByText("510300")).toBeInTheDocument();
    expect(within(tooltip).getByText("3.456 / +1.65%")).toHaveClass("price-gain");
  });

  it("right-aligns the note icon and does not show stock details when it is hovered", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [{ uuid: "note", createDate: "1", modifyDate: "1", note: "Review before selling" }],
      },
    ]);
    render(<App />);

    const note = await screen.findByLabelText("Note: Review before selling");
    expect(note).toHaveAttribute("title", "Review before selling");
    expect(note).toHaveClass("comment-indicator");
    fireEvent.mouseEnter(note);
    await new Promise((resolve) => window.setTimeout(resolve, 550));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("omits ETF or LOF and the remaining name text", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH510300",
        name: "Example ETF Fund",
        transactions: [{ uuid: "etf", createDate: "1", modifyDate: "1" }],
      },
      {
        code: "SZ160000",
        name: "Sample LOF Fund",
        transactions: [{ uuid: "lof", createDate: "2", modifyDate: "2" }],
      },
    ]);
    render(<App />);

    expect(await screen.findByText("Example", { selector: ".stock-name" })).toBeInTheDocument();
    expect(screen.getByText("Sample", { selector: ".stock-name" })).toBeInTheDocument();
    expect(screen.queryByText("Example ETF Fund", { selector: ".stock-name" })).not.toBeInTheDocument();
    expect(screen.queryByText("Sample LOF Fund", { selector: ".stock-name" })).not.toBeInTheDocument();
  });

  it("shows a fluctuation range popup after hovering a price cell for a moment", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          {
            uuid: "buy",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 10,
            buyDate: "2026-09-01",
          },
        ],
      },
    ]);
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByText("10.00").closest("td") as HTMLElement);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    const popup = await screen.findByRole("tooltip");
    expect(within(popup).getByText("+10%")).toBeInTheDocument();
    expect(within(popup).getByText("11.00")).toBeInTheDocument();
    expect(within(popup).getByText("-10%")).toBeInTheDocument();
    expect(within(popup).getByText("9.00")).toBeInTheDocument();
    expect(within(popup).getByText("+1%")).toBeInTheDocument();
    expect(within(popup).getByText("-1%")).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByText("10.00").closest("td") as HTMLElement);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("places a price popup above its cell when there is not enough viewport space below", async () => {
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 100 });
    const boundingRectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 101,
      height: 1,
      left: 0,
      right: 1,
      top: 100,
      width: 1,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    try {
      render(<App />);
      expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

      fireEvent.mouseEnter(screen.getByText("10.00").closest("td") as HTMLElement);

      expect(await screen.findByRole("tooltip")).toHaveClass("price-popup-above");
    } finally {
      boundingRectSpy.mockRestore();
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    }
  });

  it("shows the live current price and percentage above the fluctuation ranges", async () => {
    fetchQuotes.mockResolvedValue({
      SH600000: { code: "SH600000", now: 10.42, yesterday: 9, percent: 0.1578 },
    });
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByText("10.00").closest("td") as HTMLElement);
    const popup = await screen.findByRole("tooltip");

    expect(popup.querySelector(".current-quote-market")).toHaveTextContent("10.42 / +15.78%");
    expect(popup.querySelector(".current-quote-market")).toHaveClass("price-gain");
    expect(popup.querySelector(".current-quote-name")).toHaveTextContent("Example Bank");
    expect(popup.querySelector(".current-quote-reference-profit")).toHaveTextContent("+42.00");
    expect(popup.querySelector(".current-quote-reference-change")).toHaveTextContent("+0.42 / +4.20%");
    expect(popup.querySelector(".current-quote-reference")).toHaveClass("price-gain");
    // 10.42 is closest to the +4% step (10.00 * 1.04 = 10.40) among all up/down steps.
    const nearestCell = popup.querySelector("td.nearest-price") as HTMLElement;
    expect(nearestCell).toHaveTextContent("10.40");
    expect(nearestCell).toHaveClass("price-gain");
    const nearestHeader = popup.querySelector("th.nearest-price") as HTMLElement;
    expect(nearestHeader).toHaveTextContent("+4%");
    expect(nearestHeader).toHaveClass("price-gain");
  });

  it("colors the dated and undated Buy and Sell candidates independently for Price Change Alert", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          { uuid: "dated-buy-loss", createDate: "1", modifyDate: "1", buyPrice: 10, buyDate: "2026-09-01" },
          { uuid: "undated-buy", createDate: "2", modifyDate: "2", buyPrice: 11 },
          { uuid: "undated-sell", createDate: "3", modifyDate: "3", sellPrice: 8 },
          { uuid: "dated-sell", createDate: "4", modifyDate: "4", buyPrice: 15, sellPrice: 12, sellDate: "2026-09-03" },
          { uuid: "closed", createDate: "6", modifyDate: "6", quantity: 100, buyPrice: 9, buyDate: "2026-09-01", sellPrice: 14, sellDate: "2026-09-02" },
        ],
      },
    ]);
    fetchQuotes.mockResolvedValue({
      SH600000: { code: "SH600000", now: 9, yesterday: 9, percent: 0 },
    });
    render(<App />);

    await screen.findAllByText("Example Bank");
    await waitFor(() => {
      expect(screen.getByText("10.00").closest("td")).toHaveClass("price-alert-loss");
      expect(screen.getByText("11.00").closest("td")).toHaveClass("price-alert-loss");
      expect(screen.getByText("12.00").closest("td")).toHaveClass("price-alert-gain");
      expect(screen.getByText("8.00").closest("td")).toHaveClass("price-alert-gain");
      expect(screen.getByText("14.00").closest("td")).not.toHaveClass("price-alert-gain");
    });
  });

  it("filters the table to only rows with an active Price Change Alert when Alerted only is selected", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          { uuid: "dated-buy-loss", createDate: "1", modifyDate: "1", buyPrice: 10, buyDate: "2026-09-01" },
          { uuid: "closed", createDate: "6", modifyDate: "6", quantity: 100, buyPrice: 9, buyDate: "2026-09-01", sellPrice: 14, sellDate: "2026-09-02" },
        ],
      },
    ]);
    fetchQuotes.mockResolvedValue({
      SH600000: { code: "SH600000", now: 9, yesterday: 9, percent: 0 },
    });
    render(<App />);

    await screen.findAllByText("Example Bank");
    await waitFor(() => {
      expect(screen.getByText("10.00").closest("td")).toHaveClass("price-alert-loss");
    });

    await user.selectOptions(screen.getByLabelText("Status"), "alerted");

    expect(screen.getAllByText("Example Bank", { selector: ".stock-name" })).toHaveLength(1);
    expect(screen.getByText("10.00")).toBeInTheDocument();
    expect(screen.queryByText("9.00")).not.toBeInTheDocument();
  });

  it("keeps a row's table position stable after editing it, even when the edit changes its sort order", async () => {
    const user = userEvent.setup();
    let ledgerState = [
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          { uuid: "low", createDate: "1", modifyDate: "1", quantity: 100, buyPrice: 10, buyDate: "2026-09-01" },
          { uuid: "high", createDate: "2", modifyDate: "2", quantity: 100, buyPrice: 20, buyDate: "2026-09-02" },
        ],
      },
    ];
    invoke.mockImplementation((command: string) => {
      if (command === "update_transaction") {
        ledgerState = [
          {
            code: "SH600000",
            name: "Example Bank",
            transactions: [
              { uuid: "low", createDate: "1", modifyDate: "1", quantity: 100, buyPrice: 30, buyDate: "2026-09-01" },
              { uuid: "high", createDate: "2", modifyDate: "2", quantity: 100, buyPrice: 20, buyDate: "2026-09-02" },
            ],
          },
        ];
        return Promise.resolve({});
      }
      return Promise.resolve(ledgerState);
    });
    render(<App />);

    const namesBefore = await screen.findAllByText("Example Bank", { selector: ".stock-name" });
    expect(namesBefore).toHaveLength(2);
    const rowsBefore = namesBefore.map((el) => el.closest("tr") as HTMLElement);
    expect(rowsBefore[0]).toHaveTextContent("10.00");
    expect(rowsBefore[1]).toHaveTextContent("20.00");

    await user.dblClick(rowsBefore[0]);
    await user.clear(screen.getByLabelText("Buy price"));
    await user.type(screen.getByLabelText("Buy price"), "30");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit transaction" })).not.toBeInTheDocument());

    await waitFor(() => {
      const namesAfter = screen.getAllByText("Example Bank", { selector: ".stock-name" });
      const rowsAfter = namesAfter.map((el) => el.closest("tr") as HTMLElement);
      expect(rowsAfter[0]).toHaveTextContent("30.00");
      expect(rowsAfter[1]).toHaveTextContent("20.00");
    });

    // Changing a filter re-applies the sort order, restoring ascending Buy Price order.
    await user.selectOptions(screen.getByLabelText("Period"), "1y");
    await user.selectOptions(screen.getByLabelText("Period"), "all");

    await waitFor(() => {
      const namesReset = screen.getAllByText("Example Bank", { selector: ".stock-name" });
      const rowsReset = namesReset.map((el) => el.closest("tr") as HTMLElement);
      expect(rowsReset[0]).toHaveTextContent("20.00");
      expect(rowsReset[1]).toHaveTextContent("30.00");
    });
  });

  it("keeps an edited row visible under Alerted only until the Status filter is changed again", async () => {
    const user = userEvent.setup();
    let ledgerState = [
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          { uuid: "buy", createDate: "1", modifyDate: "1", buyPrice: 10, buyDate: "2026-09-01" },
        ],
      },
    ];
    invoke.mockImplementation((command: string) => {
      if (command === "update_transaction") {
        ledgerState = [
          {
            code: "SH600000",
            name: "Example Bank",
            transactions: [
              { uuid: "buy", createDate: "1", modifyDate: "1", buyPrice: 9, buyDate: "2026-09-01" },
            ],
          },
        ];
        return Promise.resolve({});
      }
      return Promise.resolve(ledgerState);
    });
    fetchQuotes.mockResolvedValue({
      SH600000: { code: "SH600000", now: 9, yesterday: 9, percent: 0 },
    });
    render(<App />);

    await screen.findAllByText("Example Bank");
    await waitFor(() => {
      expect(screen.getByText("10.00").closest("td")).toHaveClass("price-alert-loss");
    });

    await user.selectOptions(screen.getByLabelText("Status"), "alerted");
    const row = screen.getByText("Example Bank", { selector: ".stock-name" }).closest("tr") as HTMLElement;

    await user.dblClick(row);
    await user.clear(screen.getByLabelText("Buy price"));
    await user.type(screen.getByLabelText("Buy price"), "9");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit transaction" })).not.toBeInTheDocument());

    // The row no longer satisfies the Alerted condition, but stays visible until the filter is reselected.
    await waitFor(() => {
      expect(screen.getByText("9.00")).toBeInTheDocument();
    });
    expect(screen.getByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Status"), "all");
    await user.selectOptions(screen.getByLabelText("Status"), "alerted");

    await waitFor(() => {
      expect(screen.queryByText("Example Bank", { selector: ".stock-name" })).not.toBeInTheDocument();
    });
  });

  it("saves configurable Price Change Alert percentages", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Example Bank", { selector: ".stock-name" });

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "Price Change Alert" }));
    expect(screen.getByLabelText("Gain (%)")).toHaveValue(3);
    expect(screen.getByLabelText("Loss (%)")).toHaveValue(3);
    await user.clear(screen.getByLabelText("Gain (%)"));
    await user.type(screen.getByLabelText("Gain (%)"), "5");
    await user.clear(screen.getByLabelText("Loss (%)"));
    await user.type(screen.getByLabelText("Loss (%)"), "4");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(window.localStorage.getItem("littlev-price-alert-settings")).toBe(
      JSON.stringify({ gainPercent: 5, lossPercent: 4 }),
    );
  });

  it("calculates sell-price reference changes from the transaction price minus the live price", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          {
            uuid: "closed",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 10,
            sellPrice: 12,
          },
        ],
      },
    ]);
    fetchQuotes.mockResolvedValue({
      SH600000: { code: "SH600000", now: 10.42, yesterday: 9, percent: 0.1578 },
    });
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByText("12.00").closest("td") as HTMLElement);
    const popup = await screen.findByRole("tooltip");

    expect(popup.querySelector(".current-quote-reference-profit")).toHaveTextContent("+158.00");
    expect(popup.querySelector(".current-quote-reference-change")).toHaveTextContent("+1.58 / +13.17%");
    expect(popup.querySelector(".current-quote-reference")).toHaveClass("price-gain");
  });

  it("renders closed transactions with a gray font color", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          {
            uuid: "open-buy",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 10,
            buyDate: "2026-09-01",
          },
        ],
      },
      {
        code: "SZ000001",
        name: "Second Bank",
        transactions: [
          {
            uuid: "closed",
            createDate: "2",
            modifyDate: "2",
            quantity: 50,
            buyPrice: 5,
            buyDate: "2026-08-01",
            sellPrice: 6,
            sellDate: "2026-08-15",
          },
        ],
      },
    ]);
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    const openRow = screen.getByText("Example Bank", { selector: ".stock-name" }).closest("tr");
    const closedRow = screen.getByText("Second Bank", { selector: ".stock-name" }).closest("tr");
    expect(openRow).not.toHaveClass("closed-row");
    expect(closedRow).toHaveClass("closed-row");
  });

  it("shows the calculated net profit for closed transactions and blank for open ones", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          {
            uuid: "open-buy",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 10,
            buyDate: "2026-09-01",
          },
        ],
      },
      {
        code: "SZ000001",
        name: "Second Bank",
        transactions: [
          {
            uuid: "closed",
            createDate: "2",
            modifyDate: "2",
            quantity: 50,
            buyPrice: 5,
            buyDate: "2026-08-01",
            sellPrice: 6,
            sellDate: "2026-08-15",
          },
        ],
      },
      {
        code: "SZ000002",
        name: "Third Bank",
        transactions: [
          {
            uuid: "no-dates",
            createDate: "3",
            modifyDate: "3",
            quantity: 50,
            buyPrice: 5,
            sellPrice: 6,
          },
        ],
      },
    ]);
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    // buyFee = 5*50*0.00025 = 0.0625 -> min fee 5; sellFee = 6*50*0.00025 = 0.075 -> min fee 5
    // stampFee = 6*50*0.0005 = 0.15; gross = (6-5)*50 = 50; net = 50 - 5 - 5 - 0.15 = 39.85
    const profitCells = await screen.findAllByText("39.85");
    expect(profitCells).toHaveLength(2);

    const openRow = screen.getByText("Example Bank", { selector: ".stock-name" }).closest("tr") as HTMLElement;
    const cells = within(openRow).getAllByRole("cell");
    expect(cells[6]).toHaveTextContent("");
  });

  it("shows the net profit percentage when hovering over Profit", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          {
            uuid: "closed",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 10,
            buyDate: "2026-09-01",
            sellPrice: 12,
            sellDate: "2026-09-02",
          },
        ],
      },
    ]);
    render(<App />);

    const profitCell = (await screen.findAllByText("189.40")).find((el) => el.closest("td"))!.closest("td") as HTMLElement;
    fireEvent.mouseEnter(profitCell);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("+18.94%");
    expect(tooltip).toHaveClass("price-gain");
  });

  it("shows the sum of visible rows' profit in the status bar", async () => {
    invoke.mockResolvedValue([
      {
        code: "SZ000001",
        name: "Second Bank",
        transactions: [
          {
            uuid: "closed-1",
            createDate: "1",
            modifyDate: "1",
            quantity: 50,
            buyPrice: 5,
            buyDate: "2026-08-01",
            sellPrice: 6,
            sellDate: "2026-08-15",
          },
        ],
      },
      {
        code: "SZ000002",
        name: "Third Bank",
        transactions: [
          {
            uuid: "closed-2",
            createDate: "2",
            modifyDate: "2",
            quantity: 50,
            buyPrice: 5,
            sellPrice: 6,
          },
        ],
      },
    ]);
    render(<App />);
    expect(await screen.findByText("Second Bank", { selector: ".stock-name" })).toBeInTheDocument();

    // Each row nets 39.85, so the total across both visible rows is 79.70.
    const filterBar = document.querySelector(".filter-bar") as HTMLElement;
    expect(filterBar).toHaveTextContent("2 records");
    const statusBar = document.querySelector(".status-bar") as HTMLElement;
    expect(within(statusBar).getByTitle("Total profit")).toHaveTextContent("79.70");
  });

  it("recomputes the Profit column and total after saving Stock Fee settings", async () => {
    const ledgers = [
      {
        code: "SZ000001",
        name: "Second Bank",
        transactions: [
          {
            uuid: "closed-1",
            createDate: "1",
            modifyDate: "1",
            quantity: 50,
            buyPrice: 5,
            buyDate: "2026-08-01",
            sellPrice: 6,
            sellDate: "2026-08-15",
          },
        ],
      },
    ];
    invoke.mockImplementation((command, args) => {
      if (command === "load_stock_ledgers") {
        return Promise.resolve(ledgers);
      }
      if (command === "get_data_directory" || command === "get_default_data_directory") {
        return Promise.resolve("C:\\Users\\Example\\Documents\\Little V");
      }
      if (command === "set_data_directory") {
        return Promise.resolve((args as { directory: string }).directory);
      }
      return Promise.resolve(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Second Bank", { selector: ".stock-name" })).toBeInTheDocument();

    const statusBar = document.querySelector(".status-bar") as HTMLElement;
    expect(within(statusBar).getByTitle("Total profit")).toHaveTextContent("39.85");

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "Stock Fee" }));
    const feeRateInput = screen.getByLabelText("Trade fee rate (%)");
    await user.clear(feeRateInput);
    await user.type(feeRateInput, "5");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // With a much higher fee rate, net profit drops below the previous total.
    await waitFor(() =>
      expect(within(statusBar).getByTitle("Total profit")).not.toHaveTextContent("39.85"),
    );
  });

  it("saves a configured data folder without moving application settings from localStorage", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dataDirectory = screen.getByLabelText("Data folder");
    expect(dataDirectory).toHaveValue("C:\\Users\\Example\\Documents\\Little V");
    await user.clear(dataDirectory);
    await user.type(dataDirectory, "C:\\Stock Data");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_data_directory", { directory: "C:\\Stock Data" }),
    );
    expect(window.localStorage.getItem("littlev-stock-data-directory")).toBe("C:\\Stock Data");
  });

  it("adjusts and applies the floating ticker window opacity from Settings", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("littlev-ticker-opacity", "80");
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "Ticker" }));
    const slider = screen.getByRole("slider", { name: "Window opacity (%)" });
    expect(slider).toHaveValue("80");

    fireEvent.change(slider, { target: { value: "50" } });

    // Dragging the slider previews the opacity live, before Save is clicked.
    expect(invoke).toHaveBeenCalledWith("set_ticker_opacity", { opacity: 50 });
    expect(window.localStorage.getItem("littlev-ticker-opacity")).toBe("80");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_ticker_opacity", { opacity: 50 }),
    );
    expect(window.localStorage.getItem("littlev-ticker-opacity")).toBe("50");
  });

  it("reverts the floating ticker window opacity preview when Settings is cancelled", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("littlev-ticker-opacity", "80");
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "Ticker" }));
    const slider = screen.getByRole("slider", { name: "Window opacity (%)" });
    fireEvent.change(slider, { target: { value: "30" } });
    expect(invoke).toHaveBeenCalledWith("set_ticker_opacity", { opacity: 30 });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(invoke).toHaveBeenCalledWith("set_ticker_opacity", { opacity: 80 });
    expect(window.localStorage.getItem("littlev-ticker-opacity")).toBe("80");
  });

  it("reloads ledger data when the backend reports an external stock-file change", async () => {
    let notifyLedgerChange: (() => void) | undefined;
    let ledgers = [
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          {
            uuid: "initial",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
          },
        ],
      },
    ];
    invoke.mockImplementation((command) => {
      if (command === "load_stock_ledgers") {
        return Promise.resolve(ledgers);
      }
      if (command === "get_data_directory") {
        return Promise.resolve("C:\\Users\\Example\\Documents\\Little V");
      }
      return Promise.resolve(undefined);
    });
    listen.mockImplementation((event, handler) => {
      if (event === "stock-ledgers-changed") {
        notifyLedgerChange = handler as () => void;
      }
      return Promise.resolve(vi.fn());
    });

    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();
    ledgers = [
      {
        code: "SZ000001",
        name: "Changed Bank",
        transactions: [
          {
            uuid: "changed",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
          },
        ],
      },
    ];
    notifyLedgerChange?.();

    expect(await screen.findByText("Changed Bank", { selector: ".stock-name" })).toBeInTheDocument();
    expect(screen.queryByText("Example Bank", { selector: ".stock-name" })).not.toBeInTheDocument();
  });

  it("discards Settings changes without applying them when Cancel is clicked", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.selectOptions(screen.getByLabelText("Language"), "zh_cn");
    expect(screen.getByRole("button", { name: "新建" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(window.localStorage.getItem("littlev-language")).toBeNull();

    // Reopening should show the still-applied (unchanged) values, not the discarded draft.
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Language")).toHaveValue("system");
  });

  it("filters rows by open/closed status", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Example Bank",
        transactions: [
          {
            uuid: "open-buy",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 10,
            buyDate: "2026-09-01",
          },
        ],
      },
      {
        code: "SZ000001",
        name: "Second Bank",
        transactions: [
          {
            uuid: "closed",
            createDate: "2",
            modifyDate: "2",
            quantity: 50,
            buyPrice: 5,
            buyDate: "2026-08-01",
            sellPrice: 6,
            sellDate: "2026-08-15",
          },
        ],
      },
      {
        code: "SZ000002",
        name: "Third Bank",
        transactions: [
          {
            uuid: "open-sell",
            createDate: "3",
            modifyDate: "3",
            quantity: 30,
            sellPrice: 7,
            sellDate: "2026-08-20",
          },
        ],
      },
    ]);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();
    expect(screen.getByText("Second Bank", { selector: ".stock-name" })).toBeInTheDocument();
    expect(screen.getByText("Third Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "Open only");
    expect(screen.getByText("Example Bank", { selector: ".stock-name" })).toBeInTheDocument();
    expect(screen.getByText("Third Bank", { selector: ".stock-name" })).toBeInTheDocument();
    expect(screen.queryByText("Second Bank", { selector: ".stock-name" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "Closed only");
    expect(screen.queryByText("Example Bank", { selector: ".stock-name" })).not.toBeInTheDocument();
    expect(screen.queryByText("Third Bank", { selector: ".stock-name" })).not.toBeInTheDocument();
    expect(screen.getByText("Second Bank", { selector: ".stock-name" })).toBeInTheDocument();
  });

  it("treats a transaction with an explicit null quantity as open even when prices and dates are present", async () => {
    invoke.mockResolvedValue([
      {
        code: "SZ000003",
        name: "Fourth Bank",
        transactions: [
          {
            uuid: "no-quantity",
            createDate: "1",
            modifyDate: "1",
            quantity: null,
            buyPrice: 5,
            buyDate: "2026-08-01",
            sellPrice: 6,
            sellDate: "2026-08-15",
          },
        ],
      },
    ]);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Fourth Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "Open only");
    expect(screen.getByText("Fourth Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "Closed only");
    expect(screen.queryByText("Fourth Bank", { selector: ".stock-name" })).not.toBeInTheDocument();
  });

  it("filters rows by period using the most recent buy or sell date", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Old Bank",
        transactions: [
          {
            uuid: "old-buy",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 10,
            buyDate: "2000-01-01",
          },
        ],
      },
      {
        code: "SZ000001",
        name: "Recent Bank",
        transactions: [
          {
            uuid: "recent-buy",
            createDate: "2",
            modifyDate: "2",
            quantity: 50,
            buyPrice: 5,
            buyDate: today(),
          },
        ],
      },
    ]);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Old Bank", { selector: ".stock-name" })).toBeInTheDocument();
    expect(screen.getByText("Recent Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Period" }), "Last 6 months");
    expect(screen.queryByText("Old Bank", { selector: ".stock-name" })).not.toBeInTheDocument();
    expect(screen.getByText("Recent Bank", { selector: ".stock-name" })).toBeInTheDocument();
  });

  it("keeps rows with no buy or sell date visible for any period filter", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH600000",
        name: "Dateless Bank",
        transactions: [
          {
            uuid: "no-date",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
          },
        ],
      },
    ]);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Dateless Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Period" }), "Last 6 months");
    expect(screen.getByText("Dateless Bank", { selector: ".stock-name" })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Period" }), "Last 2 years");
    expect(screen.getByText("Dateless Bank", { selector: ".stock-name" })).toBeInTheDocument();
  });

  it("replaces local options with API matches and restores them for an empty Enter search", async () => {
    const user = userEvent.setup();
    searchStocks.mockResolvedValue([{ code: "SZ000001", name: "Search Result" }]);
    render(<App />);
    await screen.findByText("Example Bank", { selector: ".stock-name" });
    await user.click(screen.getByRole("button", { name: "New" }));

    const stockInput = screen.getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, "result{Enter}");
    const stockOptions = await screen.findByRole("listbox");
    expect(within(stockOptions).getByRole("option", { name: /Search Result/ })).toBeInTheDocument();
    expect(within(stockOptions).queryByRole("option", { name: /Example Bank/ })).not.toBeInTheDocument();

    await user.clear(stockInput);
    await user.keyboard("{Enter}");
    expect(within(await screen.findByRole("listbox")).getByRole("option", { name: /Example Bank/ })).toBeInTheDocument();
  });

  it("closes the stock list when clicking outside the combobox", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Example Bank", { selector: ".stock-name" });
    await user.click(screen.getByRole("button", { name: "New" }));
    await user.click(screen.getByRole("button", { name: "Show existing stocks" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.click(screen.getByRole("heading", { name: "Create transaction" }));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("creates a buy-only transaction", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "New" }));

    searchStocks.mockResolvedValue([{ code: "SH600001", name: "New Bank" }]);
    const stockInput = screen.getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, "New Bank{Enter}");
    await user.click(screen.getByRole("button", { name: /New Bank/ }));

    await user.clear(screen.getByLabelText("Quantity"));
    await user.type(screen.getByLabelText("Quantity"), "100");
    await user.type(screen.getByLabelText("Buy price"), "10");
    fireEvent.change(screen.getByLabelText("Buy date"), { target: { value: "2026-09-01" } });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(invoke).toHaveBeenCalledWith("create_transaction", {
      request: expect.objectContaining({
        name: "New Bank",
        code: "SH600001",
        quantity: 100,
        buyPrice: 10,
        buyDate: "2026-09-01",
        sellPrice: null,
        sellDate: null,
      }),
    });
  });

  it("creates a sell-only transaction", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "New" }));

    searchStocks.mockResolvedValue([{ code: "SH600001", name: "New Bank" }]);
    const stockInput = screen.getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, "New Bank{Enter}");
    await user.click(screen.getByRole("button", { name: /New Bank/ }));

    await user.clear(screen.getByLabelText("Quantity"));
    await user.type(screen.getByLabelText("Quantity"), "400");
    await user.type(screen.getByLabelText("Sell price"), "12");
    fireEvent.change(screen.getByLabelText("Sell date"), { target: { value: "2026-09-02" } });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(invoke).toHaveBeenCalledWith("create_transaction", {
      request: expect.objectContaining({
        quantity: 400,
        buyPrice: null,
        buyDate: null,
        sellPrice: 12,
        sellDate: "2026-09-02",
      }),
    });
  });

  it("creates a transaction with both buy and sell sides", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "New" }));

    searchStocks.mockResolvedValue([{ code: "SH600001", name: "New Bank" }]);
    const stockInput = screen.getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, "New Bank{Enter}");
    await user.click(screen.getByRole("button", { name: /New Bank/ }));

    await user.clear(screen.getByLabelText("Quantity"));
    await user.type(screen.getByLabelText("Quantity"), "200");
    await user.type(screen.getByLabelText("Buy price"), "8");
    fireEvent.change(screen.getByLabelText("Buy date"), { target: { value: "2026-09-01" } });
    await user.type(screen.getByLabelText("Sell price"), "9");
    fireEvent.change(screen.getByLabelText("Sell date"), { target: { value: "2026-09-02" } });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(invoke).toHaveBeenCalledWith("create_transaction", {
      request: expect.objectContaining({
        quantity: 200,
        buyPrice: 8,
        sellPrice: 9,
      }),
    });
  });

  it("creates a transaction with a buy price but no buy date", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "New" }));

    searchStocks.mockResolvedValue([{ code: "SH600001", name: "New Bank" }]);
    const stockInput = screen.getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, "New Bank{Enter}");
    await user.click(screen.getByRole("button", { name: /New Bank/ }));

    await user.clear(screen.getByLabelText("Quantity"));
    await user.type(screen.getByLabelText("Buy price"), "10");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(invoke).toHaveBeenCalledWith("create_transaction", {
      request: expect.objectContaining({
        buyPrice: 10,
        buyDate: null,
        sellPrice: null,
        sellDate: null,
      }),
    });
  });

  it("rejects a sell date without a sell price", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "New" }));

    searchStocks.mockResolvedValue([{ code: "SH600001", name: "New Bank" }]);
    const stockInput = screen.getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, "New Bank{Enter}");
    await user.click(screen.getByRole("button", { name: /New Bank/ }));

    await user.clear(screen.getByLabelText("Quantity"));
    fireEvent.change(screen.getByLabelText("Sell date"), { target: { value: "2026-09-05" } });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Enter a sell price when a sell date is set.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("create_transaction", expect.anything());
  });

  it("rejects a buy date without a buy price", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "New" }));

    searchStocks.mockResolvedValue([{ code: "SH600001", name: "New Bank" }]);
    const stockInput = screen.getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, "New Bank{Enter}");
    await user.click(screen.getByRole("button", { name: /New Bank/ }));
    fireEvent.change(screen.getByLabelText("Buy date"), { target: { value: "2026-09-05" } });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Enter a buy price when a buy date is set.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("create_transaction", expect.anything());
  });

  it("shows the date placeholder in gray until a buy or sell date is set", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "New" }));

    expect(screen.getByLabelText("Buy date")).toHaveClass("date-empty");
    expect(screen.getByLabelText("Sell date")).toHaveClass("date-empty");

    fireEvent.change(screen.getByLabelText("Buy date"), { target: { value: "2026-09-01" } });
    expect(screen.getByLabelText("Buy date")).not.toHaveClass("date-empty");
    expect(screen.getByLabelText("Sell date")).toHaveClass("date-empty");
  });

  it("rejects a transaction with neither a buy nor sell price", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "New" }));

    searchStocks.mockResolvedValue([{ code: "SH600001", name: "New Bank" }]);
    const stockInput = screen.getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, "New Bank{Enter}");
    await user.click(screen.getByRole("button", { name: /New Bank/ }));
    await user.clear(screen.getByLabelText("Quantity"));

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Enter a buy price or sell price.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("create_transaction", expect.anything());
  });

  it("sets the price spinbox step to match each stock's decimal precision", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "New" }));

    searchStocks.mockResolvedValue([{ code: "SH600001", name: "New Bank" }]);
    const stockInput = screen.getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, "New Bank{Enter}");
    await user.click(screen.getByRole("button", { name: /New Bank/ }));

    expect(screen.getByLabelText("Buy price")).toHaveAttribute("step", "0.01");
    expect(screen.getByLabelText("Sell price")).toHaveAttribute("step", "0.01");

    searchStocks.mockResolvedValue([{ code: "SH510300", name: "An ETF" }]);
    await user.clear(stockInput);
    await user.type(stockInput, "An ETF{Enter}");
    await user.click(screen.getByRole("button", { name: /An ETF/ }));

    expect(screen.getByLabelText("Buy price")).toHaveAttribute("step", "0.001");
    expect(screen.getByLabelText("Sell price")).toHaveAttribute("step", "0.001");
  });

  it("creates a transaction with a multiline note entered at the bottom of the form", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "New" }));

    searchStocks.mockResolvedValue([{ code: "SH600001", name: "New Bank" }]);
    const stockInput = screen.getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, "New Bank{Enter}");
    await user.click(screen.getByRole("button", { name: /New Bank/ }));
    await user.type(screen.getByLabelText("Buy price"), "10");

    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "Watch earnings guidance\nCheck next quarter" },
    });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(invoke).toHaveBeenCalledWith("create_transaction", {
      request: expect.objectContaining({
        name: "New Bank",
        code: "SH600001",
        note: "Watch earnings guidance\nCheck next quarter",
      }),
    });
  });

  it("highlights a missing buy or sell date when its price is present", async () => {
    invoke.mockResolvedValue([
      {
        code: "SH600001",
        name: "Missing Buy Date",
        transactions: [{ uuid: "buy", createDate: "1", modifyDate: "1", buyPrice: 10 }],
      },
      {
        code: "SZ000001",
        name: "Missing Sell Date",
        transactions: [{ uuid: "sell", createDate: "2", modifyDate: "2", sellPrice: 10 }],
      },
      {
        code: "SH600002",
        name: "Complete Dates",
        transactions: [{ uuid: "complete", createDate: "3", modifyDate: "3", buyPrice: 10, buyDate: "2026-09-01" }],
      },
    ]);
    render(<App />);

    const buyRow = (await screen.findByText("Missing Buy Date", { selector: ".stock-name" })).closest("tr") as HTMLTableRowElement;
    const sellRow = screen.getByText("Missing Sell Date", { selector: ".stock-name" }).closest("tr") as HTMLTableRowElement;
    const completeRow = screen.getByText("Complete Dates", { selector: ".stock-name" }).closest("tr") as HTMLTableRowElement;

    expect(buyRow.cells[3]).toHaveClass("missing-date");
    expect(sellRow.cells[5]).toHaveClass("missing-date");
    expect(completeRow.cells[3]).not.toHaveClass("missing-date");
  });

  it("requires a stock to be selected before saving", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "New" }));

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Select a stock.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("create_transaction", expect.anything());
  });

  it("shows a validation error when quantity is not a multiple of 100", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "New" }));

    searchStocks.mockResolvedValue([{ code: "SH600001", name: "New Bank" }]);
    const stockInput = screen.getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, "New Bank{Enter}");
    await user.click(screen.getByRole("button", { name: /New Bank/ }));

    await user.clear(screen.getByLabelText("Quantity"));
    await user.type(screen.getByLabelText("Quantity"), "150");
    await user.type(screen.getByLabelText("Buy price"), "10");
    fireEvent.change(screen.getByLabelText("Buy date"), { target: { value: "2026-09-01" } });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Quantity must be a multiple of 100.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("create_transaction", expect.anything());
  });

  it("strips decimal points typed into the quantity field", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "New" }));

    const quantityInput = screen.getByLabelText("Quantity") as HTMLInputElement;
    await user.clear(quantityInput);
    await user.type(quantityInput, "150.5");

    expect(quantityInput.value).not.toContain(".");
  });
});

describe("Merge transactions", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  beforeEach(() => {
    window.localStorage.clear();
    invoke.mockReset();
    listen.mockReset();
    open.mockReset();
    searchStocks.mockReset();
    fetchQuotes.mockReset();
    fetchQuotes.mockResolvedValue({});
    listen.mockResolvedValue(vi.fn());
    open.mockResolvedValue(null);
    const ledgers = [
      {
        code: "SH600002",
        name: "Multi Stock",
        transactions: [
          {
            uuid: "buy-a",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 10,
            buyDate: "2026-09-01",
            note: "First lot",
          },
          {
            uuid: "buy-b",
            createDate: "1",
            modifyDate: "1",
            quantity: 200,
            buyPrice: 12,
            buyDate: "2026-09-03",
            note: "Second lot",
          },
          {
            uuid: "sell-a",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            sellPrice: 15,
            sellDate: "2026-09-02",
          },
          {
            uuid: "closed",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 8,
            buyDate: "2026-08-01",
            sellPrice: 9,
            sellDate: "2026-08-05",
          },
        ],
      },
      {
        code: "SH600003",
        name: "Empty Stock",
        transactions: [
          {
            uuid: "closed-only",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 8,
            buyDate: "2026-08-01",
            sellPrice: 9,
            sellDate: "2026-08-05",
          },
        ],
      },
    ];
    invoke.mockImplementation((command, args) => {
      if (command === "load_stock_ledgers") {
        return Promise.resolve(ledgers);
      }
      if (command === "get_data_directory" || command === "get_default_data_directory") {
        return Promise.resolve("C:\\Users\\Example\\Documents\\Little V");
      }
      if (command === "set_data_directory") {
        return Promise.resolve((args as { directory: string }).directory);
      }
      return Promise.resolve(undefined);
    });
  });

  async function selectMergeStock(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, name: string) {
    const stockInput = within(dialog).getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, name);
    await user.click(within(dialog).getByRole("button", { name: new RegExp(name) }));
  }

  it("merges two selected open buy transactions into one weighted-average transaction", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("Multi Stock", { selector: ".stock-name" });

    await user.click(screen.getByRole("button", { name: "Merge" }));
    const dialog = screen.getByRole("dialog", { name: "Merge transactions" });
    await selectMergeStock(user, dialog, "Multi Stock");

    const rows = within(dialog).getAllByRole("row").filter((row) => within(row).queryByRole("checkbox"));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      if (within(row).queryByText("10.00") || within(row).queryByText("12.00")) {
        await user.click(within(row).getByRole("checkbox"));
      }
    }

    const detail = dialog.querySelector(".merge-detail") as HTMLElement;
    expect(within(detail).getByLabelText("Quantity")).toHaveValue(300);
    expect(within(detail).getByLabelText("Price")).toHaveValue(Number((34 / 3).toFixed(2)));
    expect(within(detail).getByLabelText("Date")).toHaveValue("2026-09-03");
    expect(within(detail).getByLabelText("Note")).toHaveValue("First lot\nSecond lot");
    for (const field of within(detail).getAllByRole("spinbutton")) {
      expect(field).toHaveAttribute("readonly");
    }
    expect(within(detail).getByLabelText("Date")).toHaveAttribute("readonly");
    expect(within(detail).getByLabelText("Note")).toHaveAttribute("readonly");
    expect(within(detail).queryByText("Side")).not.toBeInTheDocument();

    const mergeButton = within(dialog).getByRole("button", { name: "Merge" });
    expect(mergeButton).toBeEnabled();
    await user.click(mergeButton);

    expect(invoke).toHaveBeenCalledWith("merge_transactions", {
      request: {
        code: "SH600002",
        uuids: expect.arrayContaining(["buy-a", "buy-b"]),
        quantity: 300,
        buyPrice: 34 / 3,
        buyDate: "2026-09-03",
        sellPrice: null,
        sellDate: null,
        note: "First lot\nSecond lot",
      },
    });
  });

  it("disables the checkboxes of the opposite side once a transaction is selected", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("Multi Stock", { selector: ".stock-name" });

    await user.click(screen.getByRole("button", { name: "Merge" }));
    const dialog = screen.getByRole("dialog", { name: "Merge transactions" });
    await selectMergeStock(user, dialog, "Multi Stock");

    const rows = within(dialog).getAllByRole("row").filter((row) => within(row).queryByRole("checkbox"));
    const buyRow = rows.find((row) => within(row).queryByText("10.00"))!;
    const sellRow = rows.find((row) => within(row).queryByText("15.00"))!;
    await user.click(within(buyRow).getByRole("checkbox"));

    expect(within(sellRow).getByRole("checkbox")).toBeDisabled();
    expect(invoke).not.toHaveBeenCalledWith("merge_transactions", expect.anything());
  });

  it("disables the Merge button until at least two rows are selected", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("Multi Stock", { selector: ".stock-name" });

    await user.click(screen.getByRole("button", { name: "Merge" }));
    const dialog = screen.getByRole("dialog", { name: "Merge transactions" });
    await selectMergeStock(user, dialog, "Multi Stock");

    expect(within(dialog).getByRole("button", { name: "Merge" })).toBeDisabled();

    const rows = within(dialog).getAllByRole("row").filter((row) => within(row).queryByRole("checkbox"));
    const buyRow = rows.find((row) => within(row).queryByText("10.00"))!;
    await user.click(within(buyRow).getByRole("checkbox"));

    expect(within(dialog).getByRole("button", { name: "Merge" })).toBeDisabled();
  });

  it("shows an empty state when the selected stock has no valid open transactions", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("Multi Stock", { selector: ".stock-name" });

    await user.click(screen.getByRole("button", { name: "Merge" }));
    const dialog = screen.getByRole("dialog", { name: "Merge transactions" });
    await selectMergeStock(user, dialog, "Empty Stock");

    expect(
      within(dialog).getByText("This stock has no valid open transactions to merge."),
    ).toBeInTheDocument();
  });

  it("shows the transactions table before any stock is selected", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("Multi Stock", { selector: ".stock-name" });

    await user.click(screen.getByRole("button", { name: "Merge" }));
    const dialog = screen.getByRole("dialog", { name: "Merge transactions" });

    expect(within(dialog).getByRole("table")).toBeInTheDocument();
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
    expect(dialog.querySelector(".merge-detail")).toBeInTheDocument();
  });

  it("shows every stock again when reopening the list after a stock is already selected", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("Multi Stock", { selector: ".stock-name" });

    await user.click(screen.getByRole("button", { name: "Merge" }));
    const dialog = screen.getByRole("dialog", { name: "Merge transactions" });
    await selectMergeStock(user, dialog, "Multi Stock");

    await user.click(within(dialog).getByRole("button", { name: "Show existing stocks" }));

    expect(within(dialog).getByRole("button", { name: /Empty Stock/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Multi Stock/ })).toBeInTheDocument();
  });

  it("shows the selected stock's live quote and change after the combobox", async () => {
    const user = userEvent.setup();
    fetchQuotes.mockResolvedValue({
      SH600002: { code: "SH600002", now: 13.5, yesterday: 12, percent: 0.125 },
    });
    render(<App />);
    await screen.findAllByText("Multi Stock", { selector: ".stock-name" });
    await waitFor(() => expect(fetchQuotes).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Merge" }));
    const dialog = screen.getByRole("dialog", { name: "Merge transactions" });
    await selectMergeStock(user, dialog, "Multi Stock");

    const quote = await within(dialog).findByText("13.50 / +12.50%");
    expect(quote).toHaveClass("stock-current-quote");
    expect(quote.closest(".stock-combobox")).not.toBeNull();
  });
});

describe("Split transaction", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  beforeEach(() => {
    window.localStorage.clear();
    invoke.mockReset();
    listen.mockReset();
    open.mockReset();
    searchStocks.mockReset();
    fetchQuotes.mockReset();
    fetchQuotes.mockResolvedValue({});
    listen.mockResolvedValue(vi.fn());
    open.mockResolvedValue(null);
    const ledgers = [
      {
        code: "SH600002",
        name: "Multi Stock",
        transactions: [
          {
            uuid: "buy-a",
            createDate: "1",
            modifyDate: "1",
            quantity: 200,
            buyPrice: 12,
            buyDate: "2026-09-03",
            note: "Second lot",
          },
          {
            uuid: "sell-a",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            sellPrice: 15,
            sellDate: "2026-09-02",
          },
          {
            uuid: "closed",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 8,
            buyDate: "2026-08-01",
            sellPrice: 9,
            sellDate: "2026-08-05",
          },
        ],
      },
      {
        code: "SH600003",
        name: "Empty Stock",
        transactions: [
          {
            uuid: "closed-only",
            createDate: "1",
            modifyDate: "1",
            quantity: 100,
            buyPrice: 8,
            buyDate: "2026-08-01",
            sellPrice: 9,
            sellDate: "2026-08-05",
          },
        ],
      },
    ];
    invoke.mockImplementation((command, args) => {
      if (command === "load_stock_ledgers") {
        return Promise.resolve(ledgers);
      }
      if (command === "get_data_directory" || command === "get_default_data_directory") {
        return Promise.resolve("C:\\Users\\Example\\Documents\\Little V");
      }
      if (command === "set_data_directory") {
        return Promise.resolve((args as { directory: string }).directory);
      }
      return Promise.resolve(undefined);
    });
  });

  async function selectSplitStock(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, name: string) {
    const stockInput = within(dialog).getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, name);
    await user.click(within(dialog).getByRole("button", { name: new RegExp(name) }));
  }

  it("shows the transactions table before any stock is selected", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("Multi Stock", { selector: ".stock-name" });

    await user.click(screen.getByRole("button", { name: "Split" }));
    const dialog = screen.getByRole("dialog", { name: "Split transaction" });

    expect(within(dialog).getByRole("table")).toBeInTheDocument();
    expect(within(dialog).queryAllByRole("radio")).toHaveLength(0);
    expect(dialog.querySelector(".split-detail")).toBeInTheDocument();
  });

  it("shows an empty state when the selected stock has no valid open transactions", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("Multi Stock", { selector: ".stock-name" });

    await user.click(screen.getByRole("button", { name: "Split" }));
    const dialog = screen.getByRole("dialog", { name: "Split transaction" });
    await selectSplitStock(user, dialog, "Empty Stock");

    expect(
      within(dialog).getByText("This stock has no valid open transactions to split."),
    ).toBeInTheDocument();
  });

  it("defaults the left quantity to half of the selected transaction and computes the right side to conserve value", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("Multi Stock", { selector: ".stock-name" });

    await user.click(screen.getByRole("button", { name: "Split" }));
    const dialog = screen.getByRole("dialog", { name: "Split transaction" });
    await selectSplitStock(user, dialog, "Multi Stock");

    const rows = within(dialog).getAllByRole("row").filter((row) => within(row).queryByRole("radio"));
    const buyRow = rows.find((row) => within(row).queryByText("12.00"))!;
    await user.click(within(buyRow).getByRole("radio"));

    expect(within(dialog).getAllByRole("spinbutton", { name: "Quantity" })[0]).toHaveValue(100);
    const splitButton = within(dialog).getByRole("button", { name: "Split" });
    expect(splitButton).toBeEnabled();

    await user.click(splitButton);

    expect(invoke).toHaveBeenCalledWith("split_transaction", {
      request: {
        code: "SH600002",
        uuid: "buy-a",
        leftQuantity: 100,
        leftPrice: 12,
        rightQuantity: 100,
        rightPrice: 12,
      },
    });
  });

  it("recomputes the right price when the left price is edited", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("Multi Stock", { selector: ".stock-name" });

    await user.click(screen.getByRole("button", { name: "Split" }));
    const dialog = screen.getByRole("dialog", { name: "Split transaction" });
    await selectSplitStock(user, dialog, "Multi Stock");

    const rows = within(dialog).getAllByRole("row").filter((row) => within(row).queryByRole("radio"));
    const buyRow = rows.find((row) => within(row).queryByText("12.00"))!;
    await user.click(within(buyRow).getByRole("radio"));

    const priceInputs = within(dialog).getAllByRole("spinbutton", { name: "Price" });
    await user.clear(priceInputs[0]);
    await user.type(priceInputs[0], "14");

    expect(within(dialog).getAllByRole("spinbutton", { name: "Price" })[1]).toHaveValue(10);
  });

  it("disables the Split button until a transaction is selected", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("Multi Stock", { selector: ".stock-name" });

    await user.click(screen.getByRole("button", { name: "Split" }));
    const dialog = screen.getByRole("dialog", { name: "Split transaction" });
    await selectSplitStock(user, dialog, "Multi Stock");

    expect(within(dialog).getByRole("button", { name: "Split" })).toBeDisabled();
  });
});
