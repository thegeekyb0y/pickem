import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { ballotAnswers, events, options, questions, votes } from "@/db/schema/app";
import { profileInitials } from "@/lib/profile";
import { Badge } from "@/components/ui/badge";
import SignInButton from "@/app/events/new/_components/sign-in-button";
import ProfileSettingsForm from "./profile-settings-form";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function ProfilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const viewer = session?.user;

  if (!viewer) {
    return (
      <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
        <section className="mx-auto w-full max-w-lg rounded-xl border border-border bg-surface-1 p-6 text-center sm:p-8">
          <h1 className="text-balance text-2xl font-bold">Sign in to view your profile</h1>
          <p className="mx-auto mt-2 max-w-sm text-pretty text-sm leading-5 text-muted-foreground">
            Your quizzes, drafts and signed-in picks are saved to your account.
          </p>
          <div className="mt-5">
            <SignInButton callbackURL="/profile" label="Continue with Google" />
          </div>
        </section>
      </main>
    );
  }

  const [owned, ballots] = await Promise.all([
    db
      .select({
        id: events.id,
        title: events.title,
        description: events.description,
        status: events.status,
        updatedAt: events.updatedAt,
      })
      .from(events)
      .where(eq(events.creatorUserId, viewer.id))
      .orderBy(desc(events.updatedAt)),
    db
      .select({
        id: votes.id,
        eventId: votes.eventId,
        createdAt: votes.createdAt,
      })
      .from(votes)
      .where(eq(votes.voterUserId, viewer.id))
      .orderBy(desc(votes.createdAt)),
  ]);

  const eventIds = [...new Set(ballots.map((ballot) => ballot.eventId))];
  const ballotIds = ballots.map((ballot) => ballot.id);

  const [pickedEvents, answers] = await Promise.all([
    eventIds.length
      ? db.select({ id: events.id, title: events.title }).from(events).where(inArray(events.id, eventIds))
      : Promise.resolve([]),
    ballotIds.length
      ? db
          .select({
            voteId: ballotAnswers.voteId,
            questionId: questions.id,
            questionPrompt: questions.prompt,
            optionLabel: options.label,
            rank: ballotAnswers.rankPosition,
          })
          .from(ballotAnswers)
          .innerJoin(questions, eq(ballotAnswers.questionId, questions.id))
          .innerJoin(options, eq(ballotAnswers.optionId, options.id))
          .where(inArray(ballotAnswers.voteId, ballotIds))
          .orderBy(ballotAnswers.voteId, questions.sortOrder, ballotAnswers.rankPosition)
      : Promise.resolve([]),
  ]);

  const titles = new Map(pickedEvents.map((event) => [event.id, event.title]));
  const answersByBallot = new Map<string, Map<string, { prompt: string; labels: string[] }>>();
  for (const answer of answers) {
    const byQuestion = answersByBallot.get(answer.voteId) ?? new Map();
    const current = byQuestion.get(answer.questionId) ?? { prompt: answer.questionPrompt, labels: [] };
    current.labels.push(answer.optionLabel);
    byQuestion.set(answer.questionId, current);
    answersByBallot.set(answer.voteId, byQuestion);
  }

  const quizzes = owned.filter((event) => event.status !== "draft");
  const drafts = owned.filter((event) => event.status === "draft");
  const displayName = viewer.name.trim() || viewer.email;

  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground sm:px-6 lg:py-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <header className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface-1 p-5 sm:p-7">
          {viewer.image ? (
            <Image
              src={viewer.image}
              alt=""
              width={64}
              height={64}
              unoptimized
              className="size-16 rounded-full border border-border object-cover"
            />
          ) : (
            <div
              role="img"
              aria-label={`${displayName} initials`}
              className="grid size-16 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-lg font-bold text-foreground"
            >
              {profileInitials(viewer.name, viewer.email)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-balance text-2xl font-bold">Your profile</h1>
            <p className="mt-1 truncate text-sm text-muted-foreground">{viewer.email}</p>
            <p className="mt-1 text-xs text-subtle-foreground">Email is read-only.</p>
          </div>
        </header>

        <section aria-labelledby="profile-settings-title" className="rounded-xl border border-border bg-surface-1 p-5 sm:p-6">
          <h2 id="profile-settings-title" className="mb-4 text-balance text-lg font-bold">
            Settings
          </h2>
          <ProfileSettingsForm initialName={viewer.name} />
        </section>

        <section aria-labelledby="my-quizzes-title" className="rounded-xl border border-border bg-surface-1 p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="my-quizzes-title" className="text-balance text-lg font-bold">My quizzes</h2>
            <Link href="/events/new" className="text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              Create a quiz
            </Link>
          </div>
          {quizzes.length ? (
            <ul className="mt-4 divide-y divide-border">
              {quizzes.map((quiz) => (
                <li key={quiz.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{quiz.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge
                        size="compact"
                        color={
                          quiz.status === "open"
                            ? "green"
                            : quiz.status === "scheduled"
                              ? "amber"
                              : quiz.status === "cancelled"
                                ? "red"
                                : "gray"
                        }
                      >
                        {quiz.status}
                      </Badge>
                      <p className="font-mono text-xs tabular-nums text-muted-foreground">
                        Edited {dateFormat.format(quiz.updatedAt)}
                      </p>
                    </div>
                  </div>
                  <Link href={`/events/${quiz.id}`} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm font-medium hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-pretty text-sm text-muted-foreground">Your published quizzes will appear here.</p>
          )}
        </section>

        <section aria-labelledby="my-drafts-title" className="rounded-xl border border-border bg-surface-1 p-5 sm:p-6">
          <h2 id="my-drafts-title" className="text-balance text-lg font-bold">My drafts</h2>
          {drafts.length ? (
            <ul className="mt-4 divide-y divide-border">
              {drafts.map((draft) => (
                <li key={draft.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{draft.title}</p>
                    <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
                      Edited {dateFormat.format(draft.updatedAt)}
                    </p>
                  </div>
                  <Link href={`/events/new?draft=${draft.id}`} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm font-medium hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    Resume
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3">
              <p className="text-pretty text-sm text-muted-foreground">Your saved drafts will appear here.</p>
              <Link href="/events/new" className="mt-3 inline-flex min-h-11 items-center rounded-md bg-accent-hover px-4 text-sm font-medium text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                Create a quiz
              </Link>
            </div>
          )}
        </section>

        <section aria-labelledby="my-picks-title" className="rounded-xl border border-border bg-surface-1 p-5 sm:p-6">
          <h2 id="my-picks-title" className="text-balance text-lg font-bold">My picks</h2>
          {ballots.length ? (
            <ul className="mt-4 divide-y divide-border">
              {ballots.map((ballot) => {
                const answersForBallot = answersByBallot.get(ballot.id);
                const summary = answersForBallot
                  ? [...answersForBallot.values()].map(({ prompt, labels }) => `${prompt}: ${labels.join(", ")}`).join(" · ")
                  : "Submitted ballot";
                return (
                  <li key={ballot.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <Link href={`/events/${ballot.eventId}`} className="font-medium underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                        {titles.get(ballot.eventId) ?? "Quiz"}
                      </Link>
                      <p className="mt-1 text-pretty text-sm text-muted-foreground">{summary}</p>
                    </div>
                    <time dateTime={ballot.createdAt.toISOString()} className="font-mono text-xs tabular-nums text-subtle-foreground">
                      {dateFormat.format(ballot.createdAt)}
                    </time>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-pretty text-sm text-muted-foreground">Your signed-in picks will appear here.</p>
          )}
        </section>
      </div>
    </main>
  );
}
