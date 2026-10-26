"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  localInputToUtcIso,
  utcInstantToLocalInput,
} from "@/lib/events/date-time";
import { cn } from "@/lib/cn";

type DateTimePickerProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  errorId?: string;
  kind: "opens" | "closes";
  referenceInstant?: string;
  disabled?: boolean;
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function dateKey(date: Date) {
  return [
    date.getFullYear().toString().padStart(4, "0"),
    (date.getMonth() + 1).toString().padStart(2, "0"),
    date.getDate().toString().padStart(2, "0"),
  ].join("-");
}

function dateAtLocalNoon(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day, 12);
}

function localDateTimeToUtc(date: Date, time: string) {
  return localInputToUtcIso(`${dateKey(date)}T${time}`);
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function DateTimePicker({
  id,
  label,
  value,
  onChange,
  error,
  errorId,
  kind,
  referenceInstant,
  disabled = false,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const localValue = value ? utcInstantToLocalInput(value) ?? "" : "";
  const [localDate, localTime] = localValue.split("T");
  const selectedDate = localDate ? dateAtLocalNoon(localDate) : undefined;
  const today = startOfToday();
  const referenceDate = referenceInstant
    ? (() => {
        const local = utcInstantToLocalInput(referenceInstant);
        return local ? dateAtLocalNoon(local.slice(0, 10)) : undefined;
      })()
    : undefined;
  const defaultTime = kind === "opens" ? "09:00" : "17:00";
  const timeValue = localTime || defaultTime;
  const describedBy = [error ? errorId : null, localError ? `${id}-local-error` : null]
    .filter(Boolean)
    .join(" ") || undefined;

  function saveLocalDateTime(date: Date, time: string) {
    const instant = localDateTimeToUtc(date, time);
    if (!instant) {
      setLocalError("That local time does not exist. Choose another time.");
      return false;
    }
    setLocalError(null);
    onChange(instant);
    return true;
  }

  function savePreset(daysFromBase: number) {
    const now = new Date();
    const base = kind === "closes" && referenceDate ? referenceDate : now;
    const target = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12);
    target.setDate(target.getDate() + daysFromBase);
    const time = kind === "opens" && daysFromBase === 0
      ? `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`
      : timeValue;
    if (saveLocalDateTime(target, time)) setOpen(false);
  }

  const presets = kind === "opens"
    ? [
        { label: "Today", days: 0 },
        { label: "Tomorrow", days: 1 },
        { label: "Next week", days: 7 },
      ]
    : [
        { label: "In 1 day", days: 1 },
        { label: "In 1 week", days: 7 },
        { label: "In 1 month", days: 30 },
      ];

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <Popover open={open} onOpenChange={(next) => { if (!disabled) setOpen(next); }}>
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="tertiary"
              leadingIcon={CalendarDays}
              trailingIcon={ChevronDown}
              disabled={disabled}
              aria-label={`${label}: ${selectedDate ? dateFormat.format(selectedDate) : "choose date"}`}
              aria-expanded={open}
              aria-invalid={Boolean(error || localError)}
              aria-describedby={describedBy}
              className={cn(
                "font-fluid min-h-11 w-full justify-between rounded-md bg-background px-3 text-left",
                !selectedDate && "text-muted-foreground",
                (error || localError) && "border-accent",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-left">
                {selectedDate ? dateFormat.format(selectedDate) : "Choose a date"}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={8}
            className="w-[min(22.5rem,calc(100vw-1rem))] p-3"
          >
            <div className="max-h-[min(80dvh,42rem)] overflow-y-auto">
              <div role="group" aria-label="Date presets" className="mb-2 flex flex-wrap gap-1.5">
                {presets.map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    variant="secondary"
                    size="compact"
                    className="font-fluid min-h-9 px-2.5"
                    onClick={() => savePreset(preset.days)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  if (date) saveLocalDateTime(date, timeValue);
                }}
                disabled={{ before: today }}
                startMonth={today}
                defaultMonth={selectedDate ?? today}
                fixedWeeks
              />
              <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
                <p className="min-w-0 text-xs text-muted-foreground">
                  Time shown in <span className="font-medium text-foreground">{timezone}</span>
                </p>
                <Button
                  type="button"
                  variant="primary"
                  size="compact"
                  className="font-fluid min-h-9 px-3"
                  disabled={!selectedDate}
                  onClick={() => setOpen(false)}
                >
                  Done
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <div>
          <label htmlFor={`${id}-time`} className="sr-only">{label} time</label>
          <input
            id={`${id}-time`}
            type="time"
            value={timeValue}
            disabled={!selectedDate || disabled}
            onChange={(event) => {
              if (selectedDate) saveLocalDateTime(selectedDate, event.target.value);
            }}
            aria-label={`${label} time`}
            aria-invalid={Boolean(error || localError)}
            aria-describedby={describedBy}
            className={cn(
              "h-11 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm font-mono tabular-nums text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60",
              (error || localError) && "border-accent",
            )}
          />
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Your timezone: {timezone}. Voters see their own local time.
      </p>
      {localError ? (
        <p id={`${id}-local-error`} role="alert" className="mt-1 text-sm text-accent">
          {localError}
        </p>
      ) : null}
    </div>
  );
}
