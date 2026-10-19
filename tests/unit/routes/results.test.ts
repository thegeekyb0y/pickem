import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  event: null as Record<string, unknown> | null,
  session: null as { user?: { id: string } } | null,
  unlocked: false,
  allowed: true,
  snapshot: {
    eventId: "00000000-0000-4000-8000-000000000001",
    version: 3,
    totalBallots: 3,
    counts: { "00000000-0000-4000-8000-000000000002": 2 },
    serverNow: "2026-10-20T12:00:00.000Z",
    closesAt: "2026-10-20T13:00:00.000Z",
    closed: false,
    talliesVisible: true,
  },
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      events: {
        findFirst: vi.fn(async () => mocks.event),
      },
    },
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => mocks.session) } },
}));
vi.mock("@/lib/events/access", () => ({
  hasEventUnlock: vi.fn(async () => mocks.unlocked),
}));
vi.mock("@/lib/events/results", () => ({
  areTalliesVisible: (event: { status: string }) => event.status !== "draft",
  getResultSnapshot: vi.fn(async () => mocks.snapshot),
}));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "127.0.0.1",
  limitResultsRequest: vi.fn(async () => mocks.allowed),
}));

import { GET } from "@/app/api/events/[id]/results/route";

const eventId = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-10-20T12:00:00.000Z");

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: eventId,
    creatorUserId: "owner",
    status: "open",
    visibility: "discoverable",
    passcodeHash: null,
    pickType: "single",
    opensAt: new Date(now.getTime() - 60_000),
    closesAt: new Date(now.getTime() + 60 * 60 * 1000),
    ...overrides,
  };
}

async function requestResults() {
  return GET(
    new Request(`https://pickem.example/api/events/${eventId}/results`, {
      headers: { "x-client-id": "pickem-test-client-1234" },
    }),
    { params: Promise.resolve({ id: eventId }) },
  );
}

describe("results route guards and cache headers", () => {
  beforeEach(() => {
    mocks.event = makeEvent();
    mocks.session = null;
    mocks.unlocked = false;
    mocks.allowed = true;
  });

  it("serves public open results with short shared caching", async () => {
    const response = await requestResults();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=1, stale-while-revalidate=4",
    );
    expect(await response.json()).toMatchObject({ version: 3, totalBallots: 3 });
  });

  it("serves final closed results with long shared caching", async () => {
    mocks.event = makeEvent({ status: "closed" });
    mocks.snapshot = { ...mocks.snapshot, closed: true };
    const response = await requestResults();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=86400, stale-while-revalidate=604800",
    );
  });

  it("keeps locked passcode results private and does not return a snapshot", async () => {
    mocks.event = makeEvent({ visibility: "passcode", passcodeHash: "hash" });
    const response = await requestResults();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("allows unlocked passcode results but keeps them private", async () => {
    mocks.event = makeEvent({ visibility: "passcode", passcodeHash: "hash" });
    mocks.unlocked = true;
    const response = await requestResults();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns 404 for a draft non-owner and private data for its owner", async () => {
    mocks.event = makeEvent({ status: "draft" });
    expect((await requestResults()).status).toBe(404);

    mocks.session = { user: { id: "owner" } };
    const response = await requestResults();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ talliesVisible: false, counts: {} });
  });

  it("does not cache rate-limit failures or invalid IDs", async () => {
    mocks.allowed = false;
    const limited = await requestResults();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("private, no-store");

    const invalid = await GET(
      new Request("https://pickem.example/api/events/nope/results"),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(invalid.status).toBe(404);
  });
});
