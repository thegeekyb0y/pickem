import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  snapshot: null as Record<string, unknown> | null,
  lockResult: "OK" as string | null,
  getResultSnapshot: vi.fn(),
  setCalls: [] as Array<{ key: string; value: unknown; options: unknown }>,
}));

vi.mock("@/lib/events/results", () => ({
  getResultSnapshot: mocks.getResultSnapshot,
}));
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => mocks.values.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, options: unknown) => {
      mocks.setCalls.push({ key, value, options });
      if (key.endsWith(":lock")) return mocks.lockResult;
      mocks.values.set(key, value);
      return "OK";
    }),
  },
}));

import { getCachedResultSnapshot } from "@/lib/live/result-cache";

const event = {
  id: "00000000-0000-4000-8000-000000000001",
  status: "open",
  pickType: "single" as const,
  opensAt: new Date("2026-10-20T11:00:00.000Z"),
  closesAt: new Date("2026-10-20T13:00:00.000Z"),
};

function snapshot(closed = false) {
  return {
    eventId: event.id,
    version: 1,
    totalBallots: 1,
    counts: {},
    serverNow: "2026-10-20T12:00:00.000Z",
    closesAt: event.closesAt.toISOString(),
    closed,
    talliesVisible: true,
  };
}

afterEach(() => {
  mocks.values.clear();
  mocks.setCalls.length = 0;
  mocks.lockResult = "OK";
  mocks.getResultSnapshot.mockReset();
});

describe("getCachedResultSnapshot", () => {
  it("coalesces concurrent cache misses into one database query", async () => {
    mocks.getResultSnapshot.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return snapshot();
    });

    const snapshots = await Promise.all(
      Array.from({ length: 12 }, () => getCachedResultSnapshot(event)),
    );

    expect(mocks.getResultSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshots.every((value) => value.version === 1)).toBe(true);
    expect(mocks.setCalls.find((call) => call.key.endsWith(":results:v1"))?.options).toEqual({ ex: 1 });
  });

  it("serves the stale snapshot while another instance owns the refresh lock", async () => {
    const stale = snapshot();
    mocks.values.set(`pickem:event:${event.id}:results:v1:stale`, stale);
    mocks.lockResult = null;

    expect(await getCachedResultSnapshot(event)).toEqual(stale);
    expect(mocks.getResultSnapshot).not.toHaveBeenCalled();
  });

  it("uses a longer cache lifetime for final closed results", async () => {
    const closedEvent = { ...event, status: "closed" };
    mocks.getResultSnapshot.mockResolvedValue(snapshot(true));

    await getCachedResultSnapshot(closedEvent);

    expect(mocks.setCalls.find((call) => call.key.endsWith(":results:v1"))?.options).toEqual({
      ex: 86_400,
    });
  });
});
