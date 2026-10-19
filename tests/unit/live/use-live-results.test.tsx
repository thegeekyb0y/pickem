// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultSnapshot } from "@/lib/events/results";
import { useLiveResults } from "@/lib/live/use-live-results";
import type { LiveStatus, ResultsTransport } from "@/lib/live/types";

const eventId = "00000000-0000-4000-8000-000000000001";

function makeSnapshot(overrides: Partial<ResultSnapshot> = {}): ResultSnapshot {
  return {
    eventId,
    version: 0,
    totalBallots: 0,
    counts: {},
    serverNow: new Date().toISOString(),
    closesAt: new Date(Date.now() + 60_000).toISOString(),
    closed: false,
    talliesVisible: true,
    ...overrides,
  };
}

function makeTransport(finalSnapshot = makeSnapshot({ closed: true, version: 2, totalBallots: 2 })) {
  let handlers: {
    onSnapshot(snapshot: ResultSnapshot): void;
    onStatus(status: LiveStatus): void;
  } | null = null;
  const transport: ResultsTransport = {
    subscribe: vi.fn((_eventId, _clientId, nextHandlers) => {
      handlers = nextHandlers;
      return vi.fn();
    }),
    fetchSnapshot: vi.fn(async () => finalSnapshot),
  };
  return { transport, emit: (snapshot: ResultSnapshot) => handlers?.onSnapshot(snapshot) };
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
}

describe("useLiveResults", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not subscribe while disabled or hidden, then reconnects when visible", () => {
    const { transport } = makeTransport();
    const initial = makeSnapshot();
    const { result, rerender } = renderHook(
      ({ enabled }) => useLiveResults({ eventId, initial, enabled, transport }),
      { initialProps: { enabled: false } },
    );
    expect(transport.subscribe).not.toHaveBeenCalled();
    expect(result.current.status).toBe("paused");

    setVisibility("hidden");
    rerender({ enabled: true });
    expect(transport.subscribe).not.toHaveBeenCalled();
    expect(result.current.status).toBe("paused");

    setVisibility("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(transport.subscribe).toHaveBeenCalledTimes(1);
  });

  it("ignores stale snapshots and coalesces rapid updates to the latest version", () => {
    const { transport, emit } = makeTransport();
    const initial = makeSnapshot();
    const { result } = renderHook(() =>
      useLiveResults({ eventId, initial, enabled: true, transport }),
    );

    act(() => {
      emit(makeSnapshot({ version: 2, totalBallots: 2 }));
      emit(makeSnapshot({ version: 1, totalBallots: 1 }));
    });
    expect(result.current.snapshot.totalBallots).toBe(0);

    act(() => vi.advanceTimersByTime(250));
    expect(result.current.snapshot.version).toBe(2);
    expect(result.current.snapshot.totalBallots).toBe(2);
  });

  it("performs one final fetch at the server-calculated close time and stops", async () => {
    vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
    const initial = makeSnapshot({
      serverNow: "2026-10-20T12:00:00.000Z",
      closesAt: "2026-10-20T12:00:01.000Z",
    });
    const { transport, emit } = makeTransport(
      makeSnapshot({ version: 2, totalBallots: 2, closed: true }),
    );
    const { result } = renderHook(() =>
      useLiveResults({ eventId, initial, enabled: true, transport }),
    );

    act(() => emit({ ...initial, version: 1, totalBallots: 1 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(transport.fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("closed");
    expect(transport.subscribe).toHaveBeenCalledTimes(1);
  });
});
