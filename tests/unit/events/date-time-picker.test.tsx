// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { utcInstantToLocalInput, localInputToUtcIso } from "@/lib/events/date-time";
import { DateTimePicker } from "@/app/events/new/_components/date-time-picker";

function localDateKey(date: Date) {
  return [
    date.getFullYear().toString().padStart(4, "0"),
    (date.getMonth() + 1).toString().padStart(2, "0"),
    date.getDate().toString().padStart(2, "0"),
  ].join("-");
}

describe("DateTimePicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("sets an opening preset in the viewer's local timezone and closes when done", () => {
    const onChange = vi.fn();
    render(
      <DateTimePicker
        id="opens"
        label="Voting opens"
        kind="opens"
        value=""
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /voting opens: choose date/i }));
    expect(screen.getByText(/your timezone:/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(onChange).toHaveBeenCalledWith(
      localInputToUtcIso(`${localDateKey(tomorrow)}T09:00`),
    );
    expect(
      screen.getByRole("button", { name: /voting opens:/i }).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("uses a week-after-opening close preset and retains the selected local time", () => {
    const onChange = vi.fn();
    const referenceInstant = "2026-10-23T12:00:00.000Z";
    const localStart = utcInstantToLocalInput(referenceInstant)!;
    const start = new Date(localStart);
    start.setDate(start.getDate() + 7);

    render(
      <DateTimePicker
        id="closes"
        label="Voting closes"
        kind="closes"
        value=""
        referenceInstant={referenceInstant}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /voting closes: choose date/i }));
    fireEvent.click(screen.getByRole("button", { name: "In 1 week" }));
    expect(onChange).toHaveBeenCalledWith(
      localInputToUtcIso(`${localDateKey(start)}T17:00`),
    );

    expect(
      screen.getByRole("button", { name: /voting closes:/i }).getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
