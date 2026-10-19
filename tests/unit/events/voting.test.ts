import { describe, expect, it } from "vitest";
import { isVoteWindowOpen } from "@/lib/events/ballot-rules";

const opensAt = new Date("2026-10-20T11:00:00.000Z");
const closesAt = new Date("2026-10-20T13:00:00.000Z");

function poll(status: "open" | "scheduled" | "closed" | "cancelled" | "draft" = "open") {
  return { status, opensAt, closesAt };
}

describe("isVoteWindowOpen", () => {
  it("accepts open and scheduled events only inside the DB-time window", () => {
    const inWindow = new Date("2026-10-20T12:00:00.000Z");
    expect(isVoteWindowOpen(poll("open"), inWindow)).toBe(true);
    expect(isVoteWindowOpen(poll("scheduled"), inWindow)).toBe(true);
    expect(isVoteWindowOpen(poll("open"), opensAt)).toBe(true);
  });

  it("rejects at and beyond the close boundary and outside eligible statuses", () => {
    expect(isVoteWindowOpen(poll(), closesAt)).toBe(false);
    expect(isVoteWindowOpen(poll(), new Date(closesAt.getTime() + 1))).toBe(false);
    expect(isVoteWindowOpen(poll(), new Date(opensAt.getTime() - 1))).toBe(false);
    expect(isVoteWindowOpen(poll("closed"), new Date("2026-10-20T12:00:00Z"))).toBe(false);
    expect(isVoteWindowOpen(poll("cancelled"), new Date("2026-10-20T12:00:00Z"))).toBe(false);
    expect(isVoteWindowOpen(poll("draft"), new Date("2026-10-20T12:00:00Z"))).toBe(false);
  });
});
