import Link from "next/link";
import type { EventListItem } from "@/lib/events/list";

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function EventCard({
  poll,
  phase,
}: {
  poll: EventListItem;
  phase: "live" | "scheduled" | "closed";
}) {
  const phaseLabel =
    phase === "live" ? "Voting open" : phase === "scheduled" ? "Starts soon" : "Closed";

  return (
    <li className="list-none">
      <Link
        href={`/events/${poll.id}`}
        className="block min-h-48 rounded-lg border border-border bg-surface-1 p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent hover:border-accent"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className={`rounded-sm border px-2 py-0.5 text-xs font-medium ${
              phase === "live"
                ? "border-accent text-accent"
                : "border-border text-muted-foreground"
            }`}
          >
            {phaseLabel}
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            {poll.pickType === "single" ? "Single choice" : `Top ${poll.maxPicks}`}
          </span>
        </div>
        <h3 className="mt-4 line-clamp-2 text-balance text-xl font-bold">{poll.title}</h3>
        {poll.description ? (
          <p className="mt-2 line-clamp-2 text-pretty text-sm leading-5 text-muted-foreground">
            {poll.description}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular-nums">
          <span className="text-foreground">
            {new Intl.NumberFormat().format(poll.ballotCount)}{" "}
            {poll.ballotCount === 1 ? "ballot" : "ballots"}
          </span>
          <span className="text-muted-foreground">
            {new Intl.NumberFormat().format(poll.optionCount)} options
          </span>
        </div>
        <p className="mt-2 text-xs text-subtle-foreground">
          {phase === "scheduled" ? "Opens " : phase === "closed" ? "Closed " : "Closes "}
          {dateTime.format(phase === "scheduled" ? poll.opensAt : poll.closesAt)}
        </p>
      </Link>
    </li>
  );
}
