import { describe, expect, it } from "vitest";
import {
  CLOSED_WINDOW_MS,
  CLOSING_SOON_MS,
  getEventPhase,
  groupHomePolls,
  hydrateEventListItem,
  type CachedEventListItem,
  type EventListItem,
} from "@/lib/events/list";

const now = new Date("2026-10-20T12:00:00.000Z");

function item(overrides: Partial<EventListItem> = {}): EventListItem {
  return {
    id: crypto.randomUUID(),
    title: "Poll",
    description: null,
    status: "open",
    visibility: "discoverable",
    opensAt: new Date(now.getTime() - 60_000),
    closesAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
    coverKind: "none",
    coverRef: null,
    coverMeta: null,
    questionCount: 1,
    ballotCount: 0,
    ...overrides,
  };
}

describe("getEventPhase", () => {
  it("classifies scheduled polls and the opening boundary", () => {
    expect(getEventPhase(item({ status: "scheduled", opensAt: new Date(now.getTime() + 1) }), now)).toBe("scheduled");
    expect(getEventPhase(item({ status: "scheduled", opensAt: now }), now)).toBe("live");
  });

  it("classifies close time and explicit closed/cancelled/draft states", () => {
    expect(getEventPhase(item({ closesAt: now }), now)).toBe("closed");
    expect(getEventPhase(item({ status: "closed" }), now)).toBe("closed");
    expect(getEventPhase(item({ status: "cancelled" }), now)).toBe("cancelled");
    expect(getEventPhase(item({ status: "draft" }), now)).toBe("draft");
  });
});

describe("hydrateEventListItem", () => {
  it("restores Date objects after the cache serializes timestamps to strings", () => {
    const cached: CachedEventListItem = {
      ...item(),
      opensAt: "2026-10-20T11:59:00.000Z",
      closesAt: "2026-10-22T12:00:00.000Z",
    };

    const hydrated = hydrateEventListItem(cached);

    expect(hydrated.opensAt).toBeInstanceOf(Date);
    expect(hydrated.closesAt).toBeInstanceOf(Date);
    expect(hydrated.closesAt.toISOString()).toBe(cached.closesAt);
  });
});

describe("groupHomePolls", () => {
  it("uses the 24-hour closing-soon and 30-day closed windows", () => {
    const closingSoon = item({ closesAt: new Date(now.getTime() + CLOSING_SOON_MS) });
    const live = item();
    const upcoming = item({ status: "scheduled", opensAt: new Date(now.getTime() + 60_000) });
    const recentClosed = item({
      status: "closed",
      closesAt: new Date(now.getTime() - CLOSED_WINDOW_MS + 1),
    });
    const oldClosed = item({
      status: "closed",
      closesAt: new Date(now.getTime() - CLOSED_WINDOW_MS - 1),
    });

    const groups = groupHomePolls([live, closingSoon, upcoming, recentClosed, oldClosed], now);

    expect(groups.closingSoon).toEqual([closingSoon]);
    expect(groups.liveNow).toEqual([live]);
    expect(groups.upcoming).toEqual([upcoming]);
    expect(groups.closed).toEqual([recentClosed]);
  });

  it("sorts live by closest deadline and upcoming by opening time", () => {
    const later = item({ closesAt: new Date(now.getTime() + 10_000) });
    const sooner = item({ closesAt: new Date(now.getTime() + 1_000) });
    const groups = groupHomePolls([later, sooner], now);
    expect(groups.closingSoon).toEqual([sooner, later]);
  });
});
