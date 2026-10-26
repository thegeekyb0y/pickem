import { unstable_cache } from "next/cache";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, questions, votes, type QuizCoverKind, type QuizCoverMeta } from "@/db/schema/app";

export const CLOSING_SOON_MS = 24 * 60 * 60 * 1000;
export const CLOSED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const HOME_POLL_LIMIT = 100;

export type EventPhase = "draft" | "scheduled" | "live" | "closed" | "cancelled";

export type EventPhaseInput = {
  status: string;
  opensAt: Date;
  closesAt: Date;
};

export function getEventPhase(event: EventPhaseInput, now: Date): EventPhase {
  if (event.status === "draft") return "draft";
  if (event.status === "cancelled") return "cancelled";
  if (event.status === "closed" || event.closesAt <= now) return "closed";
  if (event.opensAt > now) return "scheduled";
  if (event.status === "open" || event.status === "scheduled") return "live";
  return "closed";
}

export type EventListItem = {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  status: string;
  visibility: string;
  opensAt: Date;
  closesAt: Date;
  coverKind: QuizCoverKind;
  coverRef: string | null;
  coverMeta: QuizCoverMeta | null;
  editedAt: Date | null;
  questionCount: number;
  ballotCount: number;
};

export type HomePollSections = {
  closingSoon: EventListItem[];
  liveNow: EventListItem[];
  upcoming: EventListItem[];
  closed: EventListItem[];
};

export function groupHomePolls(items: EventListItem[], now: Date): HomePollSections {
  const sections: HomePollSections = {
    closingSoon: [],
    liveNow: [],
    upcoming: [],
    closed: [],
  };
  const closedAfter = now.getTime() - CLOSED_WINDOW_MS;

  for (const item of items) {
    const phase = getEventPhase(item, now);
    if (phase === "live") {
      if (item.closesAt.getTime() - now.getTime() <= CLOSING_SOON_MS) {
        sections.closingSoon.push(item);
      } else {
        sections.liveNow.push(item);
      }
    } else if (phase === "scheduled") {
      sections.upcoming.push(item);
    } else if (phase === "closed" && item.closesAt.getTime() >= closedAfter) {
      sections.closed.push(item);
    }
  }

  sections.closingSoon.sort((a, b) => a.closesAt.getTime() - b.closesAt.getTime());
  sections.liveNow.sort((a, b) => a.closesAt.getTime() - b.closesAt.getTime());
  sections.upcoming.sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime());
  sections.closed.sort((a, b) => b.closesAt.getTime() - a.closesAt.getTime());
  return sections;
}

async function queryDiscoverablePolls(): Promise<EventListItem[]> {
  const rows = await db
    .select({
      id: events.id,
      slug: events.slug,
      title: events.title,
      description: events.description,
      status: events.status,
      visibility: events.visibility,
      opensAt: events.opensAt,
      closesAt: events.closesAt,
      coverKind: events.coverKind,
      coverRef: events.coverRef,
      coverMeta: events.coverMeta,
      editedAt: events.editedAt,
    })
    .from(events)
    .where(
      and(
        eq(events.visibility, "discoverable"),
        inArray(events.status, ["scheduled", "open", "closed"]),
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(HOME_POLL_LIMIT);

  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  // Count in separate grouped queries. Correlated subqueries written through
  // `sql` templates render their column references unqualified, so
  // `where "event_id" = "id"` compares columns on the inner table and always
  // returns zero.
  const [questionRows, ballotRows] = await Promise.all([
    db
      .select({ eventId: questions.eventId, count: sql<number>`count(*)::int` })
      .from(questions)
      .where(inArray(questions.eventId, ids))
      .groupBy(questions.eventId),
    db
      .select({ eventId: votes.eventId, count: sql<number>`count(*)::int` })
      .from(votes)
      .where(inArray(votes.eventId, ids))
      .groupBy(votes.eventId),
  ]);
  const questionCounts = new Map(
    questionRows.map((row) => [row.eventId, Number(row.count)]),
  );
  const ballotCounts = new Map(
    ballotRows.map((row) => [row.eventId, Number(row.count)]),
  );

  return rows.map((row) => ({
    ...row,
    questionCount: questionCounts.get(row.id) ?? 0,
    ballotCount: ballotCounts.get(row.id) ?? 0,
  }));
}

export type CachedEventListItem = Omit<EventListItem, "opensAt" | "closesAt" | "editedAt"> & {
  opensAt: string;
  closesAt: string;
  editedAt: string | null;
};

export function hydrateEventListItem(row: CachedEventListItem): EventListItem {
  return {
    ...row,
    opensAt: new Date(row.opensAt),
    closesAt: new Date(row.closesAt),
    editedAt: row.editedAt ? new Date(row.editedAt) : null,
  };
}

const getCachedDiscoverablePolls = unstable_cache(
  async (): Promise<CachedEventListItem[]> => {
    const rows = await queryDiscoverablePolls();
    return rows.map((row) => ({
      ...row,
      opensAt: row.opensAt.toISOString(),
      closesAt: row.closesAt.toISOString(),
      editedAt: row.editedAt?.toISOString() ?? null,
    }));
  },
  ["home-discoverable-quizzes-v3"],
  { tags: ["home:polls"], revalidate: 45 },
);

export async function getDiscoverablePolls(): Promise<EventListItem[]> {
  const rows = await getCachedDiscoverablePolls();
  return rows.map(hydrateEventListItem);
}
