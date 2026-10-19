import Link from "next/link";
import { connection } from "next/server";
import { getDiscoverablePolls, groupHomePolls } from "@/lib/events/list";
import EventCard from "./events/_components/event-card";

function PollSection({
  title,
  polls,
  phase,
  emptyText,
}: {
  title: string;
  polls: Awaited<ReturnType<typeof getDiscoverablePolls>>;
  phase: "live" | "scheduled" | "closed";
  emptyText?: string;
}) {
  if (polls.length === 0 && !emptyText) return null;

  return (
    <section aria-labelledby={`section-${title.toLowerCase().replaceAll(" ", "-")}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2
          id={`section-${title.toLowerCase().replaceAll(" ", "-")}`}
          className="text-balance text-xl font-bold"
        >
          {title}
        </h2>
        {polls.length > 0 ? (
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            {new Intl.NumberFormat().format(polls.length)}
          </span>
        ) : null}
      </div>
      {polls.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {polls.map((poll) => (
            <EventCard key={poll.id} poll={poll} phase={phase} />
          ))}
        </ul>
      ) : emptyText ? (
        <div className="rounded-lg border border-border bg-surface-1 p-5">
          <p className="text-pretty text-sm leading-5 text-muted-foreground">{emptyText}</p>
        </div>
      ) : null}
    </section>
  );
}

function EmptyListing({ view }: { view: "live" | "closed" }) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-6 sm:p-8">
      <h2 className="text-balance text-xl font-bold">
        {view === "closed" ? "No recently closed polls" : "No live polls right now"}
      </h2>
      <p className="mt-2 max-w-xl text-pretty text-sm leading-5 text-muted-foreground">
        {view === "closed"
          ? "Closed polls from the last 30 days will appear here."
          : "Discoverable polls will appear here when they’re open or scheduled."}
      </p>
      <Link
        href={view === "closed" ? "/" : "/events/new"}
        className="mt-4 inline-flex rounded-md bg-accent-hover px-4 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {view === "closed" ? "View live polls" : "Create a poll"}
      </Link>
    </div>
  );
}

export default async function HomePollList({ view }: { view: "live" | "closed" }) {
  await connection();
  const now = new Date();
  const sections = groupHomePolls(await getDiscoverablePolls(), now);

  if (view === "closed") {
    return sections.closed.length === 0 ? (
      <EmptyListing view="closed" />
    ) : (
      <PollSection title="Closed in the last 30 days" polls={sections.closed} phase="closed" />
    );
  }

  const total = sections.closingSoon.length + sections.liveNow.length + sections.upcoming.length;
  if (total === 0) return <EmptyListing view="live" />;

  return (
    <div className="space-y-8">
      <PollSection title="Closing soon" polls={sections.closingSoon} phase="live" />
      <PollSection title="Live now" polls={sections.liveNow} phase="live" />
      <PollSection title="Starts soon" polls={sections.upcoming} phase="scheduled" />
    </div>
  );
}
