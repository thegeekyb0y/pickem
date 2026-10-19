import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, votePicks, votes } from "@/db/schema/app";
import type { EventListItem } from "@/lib/events/list";

export type ResultEvent = Pick<
  EventListItem,
  "id" | "status" | "pickType" | "opensAt" | "closesAt"
>;

export type ResultSnapshot = {
  eventId: string;
  /**
   * This version is monotonic only while submitted ballots are immutable and never deleted.
   * If ballot deletion is ever introduced, replace this with a durable per-event sequence.
   */
  version: number;
  totalBallots: number;
  counts: Record<string, number>;
  serverNow: string;
  closesAt: string;
  closed: boolean;
  talliesVisible: boolean;
};

export function resultSnapshotVersion(totalBallots: number) {
  return totalBallots;
}

export function areTalliesVisible(event: Pick<ResultEvent, "status">) {
  // This is the single policy point for the future owner-controlled hide-until-close setting.
  return event.status !== "draft";
}

export async function getResultSnapshot(event: ResultEvent): Promise<ResultSnapshot> {
  const totalQuery = db
    .select({ total: count() })
    .from(votes)
    .where(and(eq(votes.eventId, event.id), eq(votes.isSubmitted, true)));
  const nowQuery = db
    .select({ now: sql<Date>`clock_timestamp()` })
    .from(events)
    .where(eq(events.id, event.id));

  const countsQuery =
    event.pickType === "single"
      ? db
          .select({ optionId: votes.optionId, selections: count() })
          .from(votes)
          .where(and(eq(votes.eventId, event.id), eq(votes.isSubmitted, true)))
          .groupBy(votes.optionId)
      : db
          .select({ optionId: votePicks.optionId, selections: count() })
          .from(votePicks)
          .where(eq(votePicks.eventId, event.id))
          .groupBy(votePicks.optionId);

  const [[totalRow], countRows, [clockRow]] = await Promise.all([
    totalQuery,
    countsQuery,
    nowQuery,
  ]);
  const totalBallots = Number(totalRow?.total ?? 0);
  const counts = Object.fromEntries(
    countRows.flatMap((row) =>
      row.optionId ? [[row.optionId, Number(row.selections)] as const] : [],
    ),
  );
  const serverNow = clockRow?.now ?? new Date();
  const closed =
    event.status === "closed" ||
    event.status === "cancelled" ||
    event.status === "draft" ||
    event.opensAt > serverNow ||
    event.closesAt <= serverNow;

  return {
    eventId: event.id,
    version: resultSnapshotVersion(totalBallots),
    totalBallots,
    counts,
    serverNow: serverNow.toISOString(),
    closesAt: event.closesAt.toISOString(),
    closed,
    talliesVisible: areTalliesVisible(event),
  };
}
