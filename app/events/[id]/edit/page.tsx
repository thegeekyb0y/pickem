import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { events, votes } from "@/db/schema/app";
import Wizard, { type WizardInitial } from "../../new/_components/wizard";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) notFound();

  const isUuid = UUID_PATTERN.test(id);
  const event = isUuid
    ? await db.query.events.findFirst({
        where: eq(events.id, id),
        with: {
          questions: {
            orderBy: (table, { asc }) => [asc(table.sortOrder)],
            with: { options: { orderBy: (table, { asc }) => [asc(table.sortOrder)] } },
          },
        },
      })
    : await db.query.events.findFirst({
        where: eq(events.slug, id.toLowerCase()),
        with: {
          questions: {
            orderBy: (table, { asc }) => [asc(table.sortOrder)],
            with: { options: { orderBy: (table, { asc }) => [asc(table.sortOrder)] } },
          },
        },
      });

  if (!event || event.creatorUserId !== session.user.id) notFound();
  if (event.status === "draft") redirect(`/events/new?draft=${event.id}`);

  const [{ ballots }] = await db
    .select({ ballots: sql<number>`count(*)::int` })
    .from(votes)
    .where(eq(votes.eventId, event.id));
  const [{ now }] = await db
    .select({ now: sql<string | Date>`clock_timestamp()` })
    .from(events)
    .where(eq(events.id, event.id));
  const dbNow = new Date(now);

  const initial: WizardInitial = {
    eventId: event.id,
    draftVersion: event.draftVersion,
    hasPasscode: event.passcodeHash !== null,
    title: event.title,
    description: event.description ?? "",
    slug: event.slug ?? "",
    opensAt: event.opensAt.toISOString(),
    closesAt: event.closesAt.toISOString(),
    visibility: event.visibility,
    coverKind: event.coverKind,
    coverRef: event.coverRef,
    coverMeta: event.coverMeta,
    questions: event.questions.map((question) => ({
      prompt: question.prompt,
      description: question.description ?? "",
      pickType: question.pickType,
      maxPicks: question.maxPicks,
      options: question.options.map((option) => ({
        label: option.label,
        description: option.description ?? "",
        imageSource: option.imageSource === "external_url"
          ? "external_url"
          : option.imageSource === "blob"
            ? "blob"
            : "none",
        imageUrl: option.imageUrl ?? "",
        imageBlobKey: option.imageBlobKey ?? "",
        imageAlt: option.imageAlt ?? "",
      })),
    })),
  };

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:py-10">
        <Link
          href={`/events/${event.slug ?? event.id}`}
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ← Back to poll
        </Link>
        <div className="mt-4">
          <Wizard
            initial={initial}
            mode="edit-published"
            published={{
              ballotsExist: Number(ballots) > 0,
              datesLocked: event.status === "closed" || event.status === "cancelled" || event.closesAt <= dbNow,
              startFrozen: event.opensAt <= dbNow,
            }}
          />
        </div>
      </div>
    </main>
  );
}
