"use client";

import type { LiveStatus as Status } from "@/lib/live/types";

const labels: Partial<Record<Status, string>> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  offline: "Offline",
  unavailable: "Unavailable",
};

export default function LiveStatus({ status }: { status: Status }) {
  const label = labels[status];
  if (!label || status === "closed" || status === "paused") return null;

  return (
    <span
      aria-live="polite"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-subtle-foreground"
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${status === "live" ? "bg-accent" : "bg-subtle-foreground"}`}
      />
      {label}
    </span>
  );
}
