import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, listen, searchAnyStocks, fetchQuotes } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  searchAnyStocks: vi.fn(),
  fetchQuotes: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("./stockApi", () => ({ searchAnyStocks, fetchQuotes }));

import { TickerOverlay, TickerSettings } from "./Ticker";

describe("Ticker overlay", () => {
  beforeEach(() => {
    window.localStorage.clear();
    invoke.mockReset();
    listen.mockReset();
    fetchQuotes.mockReset();
    listen.mockResolvedValue(vi.fn());
    invoke.mockImplementation((command) => {
      if (command === "get_cached_stock_quotes") {
        return Promise.resolve({
          SH600000: { code: "SH600000", now: 10.42, yesterday: 10, percent: 0.042 },
          SH510300: { code: "SH510300", now: 4.123, yesterday: 4.2, percent: -0.0183 },
        });
      }
      if (command === "load_ticker_stocks") {
        return Promise.resolve([
          { code: "SH600000", name: "Example Bank", lower: "9", upper: "11" },
          { code: "SH510300", name: "Index ETF Fund", lower: "4.2", upper: "" },
        ]);
      }
      return Promise.resolve(undefined);
    });
    fetchQuotes.mockResolvedValue({
      SH600000: { code: "SH600000", now: 10.42, yesterday: 10, percent: 0.042 },
      SH510300: { code: "SH510300", now: 4.123, yesterday: 4.2, percent: -0.0183 },
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("restores hidden visibility by default and renders the fixed three-column grid without gain/loss colors", async () => {
    render(<TickerOverlay />);

    expect(await screen.findByText("Example Bank")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Index")).toHaveClass("ticker-alarm"));
    expect(screen.getByText("Example Bank")).not.toHaveClass("ticker-alarm");
    expect(await screen.findByText("10.42")).not.toHaveClass("price-gain", "price-loss");
    expect(screen.getByText("+4.20%")).not.toHaveClass("price-gain", "price-loss");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(invoke).toHaveBeenCalledWith("set_ticker_visibility", { visible: false });
    expect(invoke).toHaveBeenCalledWith("resize_ticker_window", { width: 240, height: 44 });
  });

  it("restores visible state and saved position from localStorage", async () => {
    window.localStorage.setItem("littlev-ticker-visible", "true");
    window.localStorage.setItem("littlev-ticker-position", JSON.stringify({ x: 123, y: 456 }));

    render(<TickerOverlay />);
    await screen.findByText("Example Bank");

    expect(invoke).toHaveBeenCalledWith("set_ticker_position", { x: 123, y: 456 });
    expect(invoke).toHaveBeenCalledWith("set_ticker_visibility", { visible: true });
  });

  it("starts native dragging from the ticker surface", async () => {
    render(<TickerOverlay />);
    const overlay = await screen.findByText("Example Bank").then((element) => element.closest(".ticker-overlay")!);

    fireEvent(overlay, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));

    expect(invoke).toHaveBeenCalledWith("start_ticker_dragging");
  });

  it("hides the floating ticker when its surface is double-clicked", async () => {
    window.localStorage.setItem("littlev-ticker-visible", "true");
    render(<TickerOverlay />);
    const overlay = await screen.findByText("Example Bank").then((element) => element.closest(".ticker-overlay")!);

    fireEvent(overlay, new MouseEvent("pointerdown", { bubbles: true, button: 0, screenX: 100, screenY: 100 }));
    fireEvent(overlay, new MouseEvent("pointerdown", { bubbles: true, button: 0, screenX: 100, screenY: 100 }));

    expect(invoke).toHaveBeenCalledWith("set_ticker_visibility", { visible: false });
    expect(window.localStorage.getItem("littlev-ticker-visible")).toBe("false");
    expect(invoke.mock.calls.filter(([command]) => command === "start_ticker_dragging")).toHaveLength(1);
  });

  it("shows the configured empty state", async () => {
    invoke.mockImplementation((command) => {
      if (command === "get_cached_stock_quotes") {
        return Promise.resolve({});
      }
      if (command === "load_ticker_stocks") {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });

    render(<TickerOverlay />);

    expect(await screen.findByText("No stocks configured.")).toBeInTheDocument();
  });

  it("applies a live opacity preview without persisting it to localStorage", async () => {
    window.localStorage.setItem("littlev-ticker-opacity", "80");
    let notifyOpacityChange: ((event: { payload: number }) => void) | undefined;
    listen.mockImplementation((event, handler) => {
      if (event === "ticker-opacity-changed") {
        notifyOpacityChange = handler as (event: { payload: number }) => void;
      }
      return Promise.resolve(vi.fn());
    });

    render(<TickerOverlay />);
    const overlay = await screen.findByText("Example Bank").then((element) => element.closest(".ticker-overlay")!);
    expect(overlay).toHaveStyle({ opacity: "0.8" });

    notifyOpacityChange?.({ payload: 30 });

    await waitFor(() => expect(overlay).toHaveStyle({ opacity: "0.3" }));
    expect(window.localStorage.getItem("littlev-ticker-opacity")).toBe("80");
  });
});

describe("Ticker settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    invoke.mockReset();
    listen.mockReset();
    searchAnyStocks.mockReset();
    fetchQuotes.mockReset();
    listen.mockResolvedValue(vi.fn());
    fetchQuotes.mockResolvedValue({
      SH600000: { code: "SH600000", now: 10.42, yesterday: 10, percent: 0.042 },
      SZ000001: { code: "SZ000001", now: 9.5, yesterday: 10, percent: -0.05 },
    });
    invoke.mockImplementation((command) => {
      if (command === "get_cached_stock_quotes") {
        return Promise.resolve({});
      }
      if (command === "load_ticker_stocks") {
        return Promise.resolve([
          { code: "SH600000", name: "Example Bank", lower: "", upper: "" },
          { code: "SZ000001", name: "Example Finance", lower: "8", upper: "12" },
        ]);
      }
      if (command === "load_stock_ledgers") {
        return Promise.resolve([
          { code: "SH600000", name: "Example Bank", transactions: [] },
          { code: "SH600003", name: "Ledger Stock", transactions: [] },
        ]);
      }
      return Promise.resolve(undefined);
    });
    searchAnyStocks.mockResolvedValue([
      { code: "SH600000", name: "Example Bank" },
      { code: "SH600002", name: "New Stock" },
    ]);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("searches on Enter and marks existing results as Added", async () => {
    const user = userEvent.setup();
    render(<TickerSettings />);
    await screen.findByText("Example Bank");

    const search = screen.getByRole("combobox", { name: "Search a stock" });
    await user.type(search, "example{enter}");

    expect(searchAnyStocks).toHaveBeenCalledWith("example");
    const resultList = document.querySelector(".ticker-results") as HTMLElement;
    expect(within(resultList).getByRole("button", { name: "Added" })).toBeDisabled();
    expect(within(resultList).getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("replaces managed stock codes with colored live prices and changes", async () => {
    render(<TickerSettings />);
    await screen.findByText("Example Bank");
    const managedList = document.querySelector(".ticker-stock-list") as HTMLElement;

    await waitFor(() => expect(within(managedList).getByText("10.42 / +4.20%")).toHaveClass("ticker-price-gain"));
    expect(within(managedList).getByText("9.50 / -5.00%")).toHaveClass("ticker-price-loss");
    expect(within(managedList).queryByText("SH600000")).not.toBeInTheDocument();
    expect(within(managedList).queryByText("SZ000001")).not.toBeInTheDocument();
  });

  it("lists ledger stocks from the search down arrow with Add and Added states", async () => {
    const user = userEvent.setup();
    render(<TickerSettings />);
    await screen.findByText("Example Bank");

    await user.click(screen.getByRole("button", { name: "Show existing stocks" }));

    const resultList = document.querySelector(".ticker-results") as HTMLElement;
    expect(within(resultList).getByText("Ledger Stock (600003)")).toBeInTheDocument();
    expect(within(resultList).getByRole("button", { name: "Added" })).toBeDisabled();
    await user.click(within(resultList).getByRole("button", { name: "Add" }));
    expect(document.querySelector(".ticker-results")).toBeInTheDocument();
    expect(within(resultList).getAllByRole("button", { name: "Added" })).toHaveLength(2);
    expect(screen.getByText("Ledger Stock")).toBeInTheDocument();
  });

  it("closes the stock pull-down when clicking outside like the Create stock combobox", async () => {
    const user = userEvent.setup();
    render(<TickerSettings />);
    await screen.findByText("Example Bank");

    await user.click(screen.getByRole("button", { name: "Show existing stocks" }));
    expect(document.querySelector(".ticker-results")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("heading", { name: "Ticker" }));

    expect(document.querySelector(".ticker-results")).not.toBeInTheDocument();
  });

  it("adds, edits alarms, reorders, deletes, and saves the JSONL model", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TickerSettings onClose={onClose} />);
    await screen.findByText("Example Bank");

    await user.type(screen.getByRole("combobox", { name: "Search a stock" }), "new");
    await user.click(screen.getByRole("button", { name: "Search" }));
    const resultList = document.querySelector(".ticker-results") as HTMLElement;
    await user.click(within(resultList).getByRole("button", { name: "Add" }));

    const managedList = document.querySelector(".ticker-stock-list") as HTMLElement;
    const newRow = within(managedList).getByText("New Stock").closest("li") as HTMLElement;
    await user.type(within(newRow).getByRole("textbox", { name: "Lower New Stock" }), "7.5");
    await user.type(within(newRow).getByRole("textbox", { name: "Upper New Stock" }), "9");
    await user.click(within(newRow).getByRole("button", { name: "Move up New Stock" }));
    await user.click(within(newRow).getByRole("button", { name: "Move up New Stock" }));

    const financeRow = within(managedList).getByText("Example Finance").closest("li") as HTMLElement;
    await user.click(within(financeRow).getByRole("button", { name: "Delete Example Finance" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(invoke).toHaveBeenCalledWith("save_ticker_stocks", {
      stocks: [
        { code: "SH600002", name: "New Stock", lower: "7.5", upper: "9" },
        { code: "SH600000", name: "Example Bank", lower: "", upper: "" },
      ],
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not start pointer reordering from an alarm input", async () => {
    render(<TickerSettings />);
    await screen.findByText("Example Bank");
    const managedList = document.querySelector(".ticker-stock-list") as HTMLElement;
    const bankRow = within(managedList).getByText("Example Bank").closest("li") as HTMLElement;
    const lowerInput = within(bankRow).getByRole("textbox", { name: "Lower Example Bank" });

    fireEvent.pointerDown(lowerInput, { pointerId: 1, button: 0, clientY: 10 });
    fireEvent.pointerMove(bankRow, { pointerId: 1, clientY: 40 });
    fireEvent.pointerUp(bankRow, { pointerId: 1, clientY: 40 });

    expect(bankRow).not.toHaveClass("dragging");
    expect(within(managedList).getAllByRole("listitem")[0]).toContainElement(screen.getByText("Example Bank"));
  });

  it("reorders rows after the pointer movement threshold", async () => {
    render(<TickerSettings />);
    await screen.findByText("Example Bank");
    const managedList = document.querySelector(".ticker-stock-list") as HTMLElement;
    const rows = within(managedList).getAllByRole("listitem");

    fireEvent(rows[0], new MouseEvent("pointerdown", { bubbles: true, button: 0, clientY: 10 }));
    fireEvent(rows[1], new MouseEvent("pointermove", { bubbles: true, clientY: 20 }));
    fireEvent(rows[1], new MouseEvent("pointerup", { bubbles: true, clientY: 20 }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_ticker_stocks", {
      stocks: [
        { code: "SZ000001", name: "Example Finance", lower: "8", upper: "12" },
        { code: "SH600000", name: "Example Bank", lower: "", upper: "" },
      ],
    }));
  });
});
