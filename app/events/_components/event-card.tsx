import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import QuizCover from "@/components/quiz-cover";
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
  const phaseLabel = phase === "live" ? "Voting open" : phase === "scheduled" ? "Starts soon" : "Closed";
  const phaseColor = phase === "live" ? "green" : phase === "scheduled" ? "amber" : "gray";

  return (
    <li className="list-none">
      <article className="min-h-48 overflow-hidden rounded-xl border border-border bg-surface-1 hover:border-accent">
        {poll.coverKind !== "none" ? (
          <div className="px-3 pt-3">
            <QuizCover
              kind={poll.coverKind}
              coverRef={poll.coverRef}
              meta={poll.coverMeta}
              layout="card"
            />
          </div>
        ) : null}
        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge size="compact" variant="dot" color={phaseColor}>
              {phaseLabel}
            </Badge>
            <span className="text-xs font-medium text-muted-foreground">
              {new Intl.NumberFormat().format(poll.questionCount)}{" "}
              {poll.questionCount === 1 ? "question" : "questions"}
            </span>
          </div>
          <h3 className="mt-4 line-clamp-2 text-balance text-xl font-bold">
            <Link
              href={`/events/${poll.id}`}
              className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {poll.title}
            </Link>
          </h3>
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
          </div>
          <p className="mt-2 text-xs text-subtle-foreground">
            {phase === "scheduled" ? "Opens " : phase === "closed" ? "Closed " : "Closes "}
            {dateTime.format(phase === "scheduled" ? poll.opensAt : poll.closesAt)}
          </p>
          {poll.coverKind === "unsplash" && poll.coverMeta?.photographer ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Photo by{" "}
              {poll.coverMeta.photographerUrl ? (
                <a
                  href={poll.coverMeta.photographerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {poll.coverMeta.photographer}
                </a>
              ) : (
                poll.coverMeta.photographer
              )}{" "}
              on Unsplash
            </p>
          ) : null}
        </div>
      </article>
    </li>
  );
}
