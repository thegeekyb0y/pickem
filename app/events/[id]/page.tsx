import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  events,
  options,
  voteGuestSessions,
  votePicks,
  votes,
} from "@/db/schema/app";
import { GUEST_COOKIE, hashGuestToken, hasEventUnlock } from "@/lib/events/access";
import { getResultSnapshot } from "@/lib/events/results";
import PasscodeGate from "./passcode-gate";
import EventDetailClient from "./event-detail-client";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }
  const event = await db.query.events.findFirst({ where: eq(events.id, id) });
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

  const snapshot = await getResultSnapshot(event);
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

  const optionRows = await db.query.options.findMany({
    where: eq(options.eventId, event.id),
    orderBy: (table, { asc }) => [asc(table.sortOrder)],
  });
  const previousRanks = viewerVote
    ? event.pickType === "single"
      ? viewerVote.optionId
        ? [viewerVote.optionId]
        : []
      : (
          await db.query.votePicks.findMany({
            where: eq(votePicks.voteId, viewerVote.id),
            orderBy: (table, { asc }) => [asc(table.rankPosition)],
          })
        ).map((pick) => pick.optionId)
    : [];

  return (
    <EventDetailClient
      event={{
        id: event.id,
        title: event.title,
        description: event.description,
        status: event.status,
        visibility: event.visibility,
        pickType: event.pickType,
        maxPicks: event.maxPicks,
        opensAt: event.opensAt.toISOString(),
        closesAt: event.closesAt.toISOString(),
      }}
      options={optionRows.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
        imageUrl: option.imageUrl,
        imageAlt: option.imageAlt,
      }))}
      selectionCounts={optionRows.map((option) => ({
        optionId: option.id,
        count: snapshot.counts[option.id] ?? 0,
      }))}
      totalBallots={snapshot.totalBallots}
      initialVoteIds={previousRanks}
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
