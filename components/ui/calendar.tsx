"use client";

import type { ComponentProps } from "react";
import { DayPicker, type ClassNames } from "react-day-picker";
import { cn } from "@/lib/cn";

const calendarClassNames: Partial<ClassNames> = {
  root: "w-full text-foreground",
  months: "flex w-full",
  month: "w-full space-y-2",
  month_caption: "relative flex h-9 items-center justify-center",
  caption_label: "text-sm font-semibold text-foreground",
  nav: "absolute inset-x-0 top-0 flex items-center justify-between",
  button_previous:
    "z-10 inline-grid size-9 place-items-center rounded-md border border-border text-muted-foreground transition-colors duration-80 hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40",
  button_next:
    "z-10 inline-grid size-9 place-items-center rounded-md border border-border text-muted-foreground transition-colors duration-80 hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40",
  month_grid: "w-full border-collapse",
  weekdays: "grid grid-cols-7",
  weekday: "flex h-9 items-center justify-center text-xs font-medium text-muted-foreground",
  weeks: "space-y-1",
  week: "grid grid-cols-7",
  day: "grid min-h-10 place-items-center text-center",
  day_button:
    "grid size-10 place-items-center rounded-md text-sm tabular-nums text-foreground transition-colors duration-80 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-selected:bg-accent aria-selected:text-accent-foreground disabled:pointer-events-none disabled:opacity-40",
  outside: "text-subtle-foreground",
  disabled: "opacity-40",
  selected: "font-semibold",
  today: "font-semibold text-accent",
};

export type CalendarProps = ComponentProps<typeof DayPicker>;

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("w-full", className)}
      classNames={{ ...calendarClassNames, ...classNames }}
      {...props}
    />
  );
}
