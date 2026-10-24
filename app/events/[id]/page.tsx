import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  ballotAnswers,
  events,
  voteGuestSessions,
  votes,
} from "@/db/schema/app";
import { GUEST_COOKIE, hashGuestToken, hasEventUnlock } from "@/lib/events/access";
import { getResultSnapshot, hideSnapshotTallies } from "@/lib/events/results";
import PasscodeGate from "./passcode-gate";
import EventDetailClient from "./event-detail-client";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const isUuid = UUID_PATTERN.test(id);
  if (!isUuid && id.length > 48) notFound();
  const event = await db.query.events.findFirst({
    where: isUuid ? eq(events.id, id) : eq(events.slug, id.toLowerCase()),
    with: {
      questions: {
        orderBy: (table, { asc }) => [asc(table.sortOrder)],
        with: { options: { orderBy: (table, { asc }) => [asc(table.sortOrder)] } },
      },
    },
  });
  if (!event) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  if (event.status === "draft" && session?.user?.id !== event.creatorUserId) {
    notFound();
  }

  if (
    event.visibility === "passcode" &&
    event.passcodeHash &&
    !(await hasEventUnlock(event.id, event.passcodeHash))
  ) {
    return <PasscodeGate eventId={event.id} />;
  }

  const rawSnapshot = await getResultSnapshot(event);
  const snapshot = rawSnapshot.talliesVisible ? rawSnapshot : hideSnapshotTallies(rawSnapshot);
  const now = new Date(snapshot.serverNow);
  const userId = session?.user?.id ?? null;
  let viewerVote: typeof votes.$inferSelect | undefined;

  if (userId) {
    viewerVote = await db.query.votes.findFirst({
      where: and(eq(votes.eventId, event.id), eq(votes.voterUserId, userId)),
    });
  } else {
    const guestToken = (await cookies()).get(GUEST_COOKIE)?.value;
    if (guestToken) {
      const tokenHash = hashGuestToken(event.id, guestToken);
      const guestSession = await db.query.voteGuestSessions.findFirst({
        where: and(
          eq(voteGuestSessions.eventId, event.id),
          eq(voteGuestSessions.guestSessionTokenHash, tokenHash),
        ),
      });
      if (guestSession) {
        viewerVote = await db.query.votes.findFirst({
          where: and(
            eq(votes.eventId, event.id),
            eq(votes.guestSessionId, guestSession.id),
          ),
        });
      }
    }
  }

  const initialAnswers: Record<string, string[]> = {};
  if (viewerVote) {
    const answers = await db.query.ballotAnswers.findMany({
      where: eq(ballotAnswers.voteId, viewerVote.id),
      orderBy: (table, { asc }) => [asc(table.questionId), asc(table.rankPosition)],
    });
    for (const answer of answers) {
      const current = initialAnswers[answer.questionId] ?? [];
      current.push(answer.optionId);
      initialAnswers[answer.questionId] = current;
    }
  }

  return (
    <EventDetailClient
      event={{
        id: event.id,
        slug: event.slug,
        title: event.title,
        description: event.description,
        status: event.status,
        visibility: event.visibility,
        opensAt: event.opensAt.toISOString(),
        closesAt: event.closesAt.toISOString(),
        coverKind: event.coverKind,
        coverRef: event.coverRef,
        coverMeta: event.coverMeta,
      }}
      questions={event.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        description: question.description,
        pickType: question.pickType,
        maxPicks: question.maxPicks,
        options: question.options.map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description,
          imageUrl: option.imageUrl,
          imageAlt: option.imageAlt,
        })),
      }))}
      initialSnapshot={snapshot}
      initialAnswers={initialAnswers}
      isLoggedIn={userId != null}
      notStarted={event.opensAt > now}
      isClosed={
        event.status === "closed" ||
        event.status === "cancelled" ||
        event.status === "draft" ||
        event.closesAt <= now ||
        event.opensAt > now
      }
      isOwner={session?.user?.id === event.creatorUserId}
    />
  );
}
