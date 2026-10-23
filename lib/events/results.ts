import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ballotAnswers, events, options, questions, votes } from "@/db/schema/app";
import type { EventListItem } from "@/lib/events/list";

export type ResultEvent = Pick<EventListItem, "id" | "status" | "opensAt" | "closesAt">;

export type QuestionResultSnapshot = {
  questionId: string;
  version: number;
  totalBallots: number;
  counts: Record<string, number>;
};

export type ResultSnapshot = {
  eventId: string;
  /**
   * Submitted ballots are immutable and never deleted, so this version is
   * monotonic. Each question also has its own monotonic answer-count version.
   */
  version: number;
  totalBallots: number;
  questions: QuestionResultSnapshot[];
  serverNow: string;
  closesAt: string;
  closed: boolean;
  talliesVisible: boolean;
};

export function resultSnapshotVersion(totalBallots: number) {
  return totalBallots;
}

export function areTalliesVisible(event: Pick<ResultEvent, "status">) {
  return event.status !== "draft";
}

export function hideSnapshotTallies(snapshot: ResultSnapshot): ResultSnapshot {
  return {
    ...snapshot,
    version: 0,
    totalBallots: 0,
    questions: snapshot.questions.map((question) => ({
      questionId: question.questionId,
      version: 0,
      totalBallots: 0,
      counts: {},
    })),
    talliesVisible: false,
  };
}

export async function getResultSnapshot(event: ResultEvent): Promise<ResultSnapshot> {
  const totalQuery = db
    .select({ total: count() })
    .from(votes)
    .where(eq(votes.eventId, event.id));
  const nowQuery = db
    .select({ now: sql<string | Date>`clock_timestamp()` })
    .from(events)
    .where(eq(events.id, event.id));
  const questionCountsQuery = db
    .select({
      questionId: questions.id,
      optionId: options.id,
      selections: count(ballotAnswers.id),
    })
    .from(questions)
    .leftJoin(options, eq(options.questionId, questions.id))
    .leftJoin(
      ballotAnswers,
      and(
        eq(ballotAnswers.questionId, questions.id),
        eq(ballotAnswers.optionId, options.id),
      ),
    )
    .where(eq(questions.eventId, event.id))
    .groupBy(questions.id, questions.sortOrder, options.id, options.sortOrder)
    .orderBy(questions.sortOrder, options.sortOrder);
  const questionTotalsQuery = db
    .select({
      questionId: ballotAnswers.questionId,
      totalBallots: sql<number>`count(distinct ${ballotAnswers.voteId})::int`,
    })
    .from(ballotAnswers)
    .innerJoin(questions, eq(questions.id, ballotAnswers.questionId))
    .where(eq(questions.eventId, event.id))
    .groupBy(ballotAnswers.questionId);

  const [[totalRow], questionRows, questionTotalRows, [clockRow]] = await Promise.all([
    totalQuery,
    questionCountsQuery,
    questionTotalsQuery,
    nowQuery,
  ]);
  const totalsByQuestion = new Map(
    questionTotalRows.map((row) => [row.questionId, Number(row.totalBallots ?? 0)]),
  );
  const questionsById = new Map<string, QuestionResultSnapshot>();
  for (const row of questionRows) {
    const totalBallots = totalsByQuestion.get(row.questionId) ?? 0;
    const question = questionsById.get(row.questionId) ?? {
      questionId: row.questionId,
      version: totalBallots,
      totalBallots,
      counts: {},
    };
    question.version = totalBallots;
    question.totalBallots = totalBallots;
    if (row.optionId) question.counts[row.optionId] = Number(row.selections);
    questionsById.set(row.questionId, question);
  }

  const totalBallots = Number(totalRow?.total ?? 0);
  const serverNow = clockRow?.now ? new Date(clockRow.now) : new Date();
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
    questions: [...questionsById.values()],
    serverNow: serverNow.toISOString(),
    closesAt: event.closesAt.toISOString(),
    closed,
    talliesVisible: areTalliesVisible(event),
  };
}
