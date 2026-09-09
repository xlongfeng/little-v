import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const { invoke, searchStocks } = vi.hoisted(() => ({ invoke: vi.fn(), searchStocks: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./stockApi", () => ({ searchStocks }));

const today = () => new Date().toISOString().slice(0, 10);

describe("App", () => {
  afterEach(cleanup);

  beforeEach(() => {
    invoke.mockReset();
    searchStocks.mockReset();
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
  });

  it("shows the app version in a smaller font appended to the About dialog title", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Example Bank")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "About" }));

    const dialog = screen.getByRole("dialog");
    const versionTag = within(dialog).getByText(/^Version \d+\.\d+\.\d+$/);
    expect(versionTag).toHaveClass("version-tag");
    expect(within(dialog).getByRole("heading")).toHaveTextContent(/^About Little V Version \d+\.\d+\.\d+$/);
    expect(within(dialog).getByText("A local stock transaction ledger.")).toBeInTheDocument();
  });

  it("filters the combined ledger table by checked stock names", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Example Bank")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Names" }));
    await user.click(screen.getByRole("checkbox", { name: "Example Bank" }));

    expect(screen.getByText(/No trading records yet/)).toBeInTheDocument();
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
    expect(await screen.findByText("Example Bank")).toBeInTheDocument();

    const indicator = screen.getByLabelText("Note: Watch earnings guidance");
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveAttribute("title", "Watch earnings guidance");
  });

  it("does not show a comment indicator when a transaction has no note", async () => {
    render(<App />);
    expect(await screen.findByText("Example Bank")).toBeInTheDocument();

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
    expect(await screen.findByText("Example Bank")).toBeInTheDocument();

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
    expect(await screen.findByText("Example Bank")).toBeInTheDocument();

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
    expect(await screen.findByText("Example Bank")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete transaction" }));
    const dialog = screen.getByRole("dialog", { name: "Delete transaction" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await within(dialog).findByText(/Could not delete transaction/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Delete transaction" })).toBeInTheDocument();
  });

  it("opens a pre-filled edit dialog with a locked stock field when a row is double-clicked", async () => {
    const user = userEvent.setup();
    render(<App />);
    const row = (await screen.findByText("Example Bank")).closest("tr");
    expect(row).not.toBeNull();

    await user.dblClick(row as HTMLElement);

    expect(screen.getByRole("heading", { name: "Edit transaction" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Stock" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Stock" })).toHaveValue("Example Bank (SH600000)");
    expect(screen.getByLabelText("Quantity")).toHaveValue(100);
    expect(screen.getByLabelText("Buy price")).toHaveValue(10);
    expect(screen.getByLabelText("Buy date")).toHaveValue("2026-09-01");
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
    const row = (await screen.findByText("Example Bank")).closest("tr");

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
    const row = (await screen.findByText("Example Bank")).closest("tr");

    await user.dblClick(row as HTMLElement);
    expect(screen.getByRole("heading", { name: "Edit transaction" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("heading", { name: "Edit transaction" })).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("update_transaction", expect.anything());
  });

  it("toggles all quick-filter names with All", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Example Bank")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Names" }));
    await user.click(screen.getByRole("checkbox", { name: "All" }));
    expect(screen.getByText(/No trading records yet/)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "All" }));
    expect(screen.getByRole("row", { name: /Example Bank/ })).toBeInTheDocument();
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
    expect(await screen.findByText("Example Bank")).toBeInTheDocument();

    expect(screen.getByText("10.50")).toBeInTheDocument();
    expect(screen.getByText("3.456")).toBeInTheDocument();
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
    expect(await screen.findByText("Example Bank")).toBeInTheDocument();

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
    expect(await screen.findByText("Example Bank")).toBeInTheDocument();

    const openRow = screen.getByText("Example Bank").closest("tr");
    const closedRow = screen.getByText("Second Bank").closest("tr");
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
    expect(await screen.findByText("Example Bank")).toBeInTheDocument();

    // buyFee = 5*50*0.00025 = 0.0625 -> min fee 5; sellFee = 6*50*0.00025 = 0.075 -> min fee 5
    // stampFee = 6*50*0.0005 = 0.15; gross = (6-5)*50 = 50; net = 50 - 5 - 5 - 0.15 = 39.85
    const profitCells = await screen.findAllByText("39.85");
    expect(profitCells).toHaveLength(2);

    const openRow = screen.getByText("Example Bank").closest("tr") as HTMLElement;
    const cells = within(openRow).getAllByRole("cell");
    expect(cells[6]).toHaveTextContent("");
  });

  it("shows the sum of visible rows' profit at the end of the menu bar", async () => {
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
    expect(await screen.findByText("Second Bank")).toBeInTheDocument();

    // Each row nets 39.85, so the total across both visible rows is 79.70.
    const menuBar = document.querySelector(".menu-bar") as HTMLElement;
    expect(within(menuBar).getByText("Total profit: 79.70")).toBeInTheDocument();
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
    expect(await screen.findByText("Example Bank")).toBeInTheDocument();
    expect(screen.getByText("Second Bank")).toBeInTheDocument();
    expect(screen.getByText("Third Bank")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "Open only");
    expect(screen.getByText("Example Bank")).toBeInTheDocument();
    expect(screen.getByText("Third Bank")).toBeInTheDocument();
    expect(screen.queryByText("Second Bank")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "Closed only");
    expect(screen.queryByText("Example Bank")).not.toBeInTheDocument();
    expect(screen.queryByText("Third Bank")).not.toBeInTheDocument();
    expect(screen.getByText("Second Bank")).toBeInTheDocument();
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
    expect(await screen.findByText("Fourth Bank")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "Open only");
    expect(screen.getByText("Fourth Bank")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "Closed only");
    expect(screen.queryByText("Fourth Bank")).not.toBeInTheDocument();
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
    expect(await screen.findByText("Old Bank")).toBeInTheDocument();
    expect(screen.getByText("Recent Bank")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Period" }), "Last 6 months");
    expect(screen.queryByText("Old Bank")).not.toBeInTheDocument();
    expect(screen.getByText("Recent Bank")).toBeInTheDocument();
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
    expect(await screen.findByText("Dateless Bank")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Period" }), "Last 6 months");
    expect(screen.getByText("Dateless Bank")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Period" }), "Last 2 years");
    expect(screen.getByText("Dateless Bank")).toBeInTheDocument();
  });

  it("replaces local options with API matches and restores them for an empty Enter search", async () => {
    const user = userEvent.setup();
    searchStocks.mockResolvedValue([{ code: "SZ000001", name: "Search Result" }]);
    render(<App />);
    await screen.findByText("Example Bank");
    await user.click(screen.getByRole("button", { name: "Create" }));

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
    await screen.findByText("Example Bank");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.click(screen.getByRole("button", { name: "Show existing stocks" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.click(screen.getByRole("heading", { name: "Create transaction" }));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("creates a buy-only transaction", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Create" }));

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
    await user.click(screen.getByRole("button", { name: "Create" }));

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
    await user.click(screen.getByRole("button", { name: "Create" }));

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
    await user.click(screen.getByRole("button", { name: "Create" }));

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

  it("creates a transaction with a sell date but no sell price", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Create" }));

    searchStocks.mockResolvedValue([{ code: "SH600001", name: "New Bank" }]);
    const stockInput = screen.getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, "New Bank{Enter}");
    await user.click(screen.getByRole("button", { name: /New Bank/ }));

    await user.clear(screen.getByLabelText("Quantity"));
    fireEvent.change(screen.getByLabelText("Sell date"), { target: { value: "2026-09-05" } });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(invoke).toHaveBeenCalledWith("create_transaction", {
      request: expect.objectContaining({
        buyPrice: null,
        buyDate: null,
        sellPrice: null,
        sellDate: "2026-09-05",
      }),
    });
  });

  it("shows the date placeholder in gray until a buy or sell date is set", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByLabelText("Buy date")).toHaveClass("date-empty");
    expect(screen.getByLabelText("Sell date")).toHaveClass("date-empty");

    fireEvent.change(screen.getByLabelText("Buy date"), { target: { value: "2026-09-01" } });
    expect(screen.getByLabelText("Buy date")).not.toHaveClass("date-empty");
    expect(screen.getByLabelText("Sell date")).toHaveClass("date-empty");
  });

  it("creates a transaction with only a stock selected", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Create" }));

    searchStocks.mockResolvedValue([{ code: "SH600001", name: "New Bank" }]);
    const stockInput = screen.getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, "New Bank{Enter}");
    await user.click(screen.getByRole("button", { name: /New Bank/ }));
    await user.clear(screen.getByLabelText("Quantity"));

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(invoke).toHaveBeenCalledWith("create_transaction", {
      request: expect.objectContaining({
        name: "New Bank",
        code: "SH600001",
        quantity: null,
        buyPrice: null,
        buyDate: null,
        sellPrice: null,
        sellDate: null,
        note: null,
      }),
    });
  });

  it("sets the price spinbox step to match each stock's decimal precision", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Create" }));

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
    await user.click(screen.getByRole("button", { name: "Create" }));

    searchStocks.mockResolvedValue([{ code: "SH600001", name: "New Bank" }]);
    const stockInput = screen.getByRole("combobox", { name: "Stock" });
    await user.type(stockInput, "New Bank{Enter}");
    await user.click(screen.getByRole("button", { name: /New Bank/ }));

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

  it("requires a stock to be selected before saving", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Create" }));

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Select a stock.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("create_transaction", expect.anything());
  });

  it("shows a validation error when quantity is not a multiple of 100", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Create" }));

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
    await user.click(screen.getByRole("button", { name: "Create" }));

    const quantityInput = screen.getByLabelText("Quantity") as HTMLInputElement;
    await user.clear(quantityInput);
    await user.type(quantityInput, "150.5");

    expect(quantityInput.value).not.toContain(".");
  });
});
