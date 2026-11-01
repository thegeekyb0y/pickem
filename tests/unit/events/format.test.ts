import { describe, expect, it } from "vitest";
import { formatPollDateTime } from "@/lib/events/format";

describe("formatPollDateTime", () => {
  it("prints the same instant in the requested zone with a zone label", () => {
    const instant = new Date("2026-11-04T11:30:00.000Z");

    expect(formatPollDateTime(instant, { locale: "en-US", timeZone: "UTC" })).toBe(
      "Nov 4, 2026, 11:30 AM UTC",
    );
    expect(
      formatPollDateTime(instant, { locale: "en-US", timeZone: "Asia/Kolkata" }),
    ).toBe("Nov 4, 2026, 5:00 PM GMT+5:30");
  });

  it("uses daylight-saving zone names for the target instant", () => {
    expect(
      formatPollDateTime(new Date("2026-01-15T12:00:00.000Z"), {
        locale: "en-US",
        timeZone: "America/New_York",
      }),
    ).toBe("Jan 15, 2026, 7:00 AM EST");
    expect(
      formatPollDateTime(new Date("2026-07-15T12:00:00.000Z"), {
        locale: "en-US",
        timeZone: "America/New_York",
      }),
    ).toBe("Jul 15, 2026, 8:00 AM EDT");
  });
});
