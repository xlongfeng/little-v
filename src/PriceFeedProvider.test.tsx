import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchQuotes } = vi.hoisted(() => ({ fetchQuotes: vi.fn() }));
vi.mock("./stockApi", () => ({ fetchQuotes }));

import { PriceFeedProvider, usePriceFeed } from "./PriceFeedProvider";

function TestConsumer({ codes }: { codes: string[] }) {
  const { quotes, setCodes, refreshIntervalSeconds, setRefreshIntervalSeconds } = usePriceFeed();
  useEffect(() => setCodes(codes), [codes, setCodes]);
  return (
    <div>
      <span data-testid="now">{quotes.SH600000?.now ?? ""}</span>
      <span data-testid="interval">{refreshIntervalSeconds}</span>
      <button type="button" onClick={() => setRefreshIntervalSeconds(5)}>
        set5
      </button>
    </div>
  );
}

describe("PriceFeedProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchQuotes.mockReset();
    fetchQuotes.mockResolvedValue({ SH600000: { code: "SH600000", now: 10, yesterday: 9, percent: 0.1111 } });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("polls immediately on mount and again after the refresh interval elapses", async () => {
    render(
      <PriceFeedProvider>
        <TestConsumer codes={["SH600000"]} />
      </PriceFeedProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("now")).toHaveTextContent("10");

    fetchQuotes.mockResolvedValue({ SH600000: { code: "SH600000", now: 11, yesterday: 9, percent: 0.2222 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("now")).toHaveTextContent("11");
  });

  it("skips polling while the window is hidden and resumes when visible again", async () => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });

    render(
      <PriceFeedProvider>
        <TestConsumer codes={["SH600000"]} />
      </PriceFeedProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchQuotes).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(fetchQuotes).not.toHaveBeenCalled();

    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
  });

  it("lets the caller change and persist the refresh interval", async () => {
    render(
      <PriceFeedProvider>
        <TestConsumer codes={["SH600000"]} />
      </PriceFeedProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId("interval")).toHaveTextContent("3");
    fireEvent.click(screen.getByRole("button", { name: "set5" }));
    expect(screen.getByTestId("interval")).toHaveTextContent("5");
    expect(window.localStorage.getItem("littlev-price-refresh-seconds")).toBe("5");
  });
});
