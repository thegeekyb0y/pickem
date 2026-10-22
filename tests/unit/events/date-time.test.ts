import { describe, expect, it } from "vitest";
import {
  localInputToUtcIso,
  parseUtcInstant,
  utcInstantToLocalInput,
} from "@/lib/events/date-time";

describe("date-time conversion", () => {
  it("round-trips a UTC instant through the current local timezone", () => {
    const original = "2026-01-15T12:00:00.000Z";
    const local = utcInstantToLocalInput(original);

    expect(local).not.toBeNull();
    expect(localInputToUtcIso(local!)).toBe(original);
  });

  it("uses the process timezone for datetime-local values", () => {
    const local = utcInstantToLocalInput("2026-01-15T12:00:00.000Z");
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (timezone === "UTC") expect(local).toBe("2026-01-15T12:00");
    if (timezone === "Asia/Kolkata") expect(local).toBe("2026-01-15T17:30");
  });

  it("rejects nonexistent local wall times instead of normalizing them", () => {
    // In America/New_York this wall time falls in the spring DST gap.
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === "America/New_York") {
      expect(localInputToUtcIso("2026-03-08T02:30")).toBeNull();
    }
  });
});

describe("parseUtcInstant", () => {
  it("accepts explicit UTC and offset timestamps independent of server timezone", () => {
    expect(parseUtcInstant("2026-01-15T12:00:00.000Z")?.toISOString()).toBe(
      "2026-01-15T12:00:00.000Z",
    );
    expect(parseUtcInstant("2026-01-15T17:30:00+05:30")?.toISOString()).toBe(
      "2026-01-15T12:00:00.000Z",
    );
  });

  it("rejects local datetime strings without a timezone", () => {
    expect(parseUtcInstant("2026-01-15T12:00")).toBeNull();
    expect(parseUtcInstant("2026-01-15 12:00:00")).toBeNull();
  });
});
