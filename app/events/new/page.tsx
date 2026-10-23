import Link from "next/link";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { events } from "@/db/schema/app";
import Wizard, { type WizardInitial } from "./_components/wizard";
import SignInButton from "./_components/sign-in-button";

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    return (
      <main className="min-h-dvh bg-background text-foreground">
        <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
          <Link
            href="/discover"
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ← Discover quizzes
          </Link>
          <div className="mt-5 rounded-xl border border-border bg-surface-1 p-6 text-center sm:p-8">
            <h1 className="text-balance text-2xl font-bold">Sign in to create a quiz</h1>
            <p className="mx-auto mt-2 max-w-sm text-pretty text-sm leading-5 text-muted-foreground">
              Quiz creation needs a Google account so your quizzes have a real owner.
              Voting stays open to everyone.
            </p>
            <div className="mt-5">
              <SignInButton callbackURL="/events/new" label="Continue with Google" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  const params = await searchParams;
  let initial: WizardInitial = {
    eventId: null,
    draftVersion: 1,
    hasPasscode: false,
    title: "",
    description: "",
    opensAt: "",
    closesAt: "",
    visibility: "unlisted",
    coverKind: "none",
    coverRef: null,
    coverMeta: null,
    questions: [],
  };

  if (params.draft) {
    const draft = await db.query.events.findFirst({
      where: eq(events.id, params.draft),
      with: {
        questions: {
          orderBy: (table, { asc }) => [asc(table.sortOrder)],
          with: { options: { orderBy: (table, { asc }) => [asc(table.sortOrder)] } },
        },
      },
    });
    if (draft && draft.creatorUserId === session.user.id && draft.status === "draft") {
      initial = {
        eventId: draft.id,
        draftVersion: draft.draftVersion,
        hasPasscode: draft.passcodeHash !== null,
        title: draft.title === "Untitled quiz" ? "" : draft.title,
        description: draft.description ?? "",
        opensAt: draft.opensAt.toISOString(),
        closesAt: draft.closesAt.toISOString(),
        visibility: draft.visibility,
        coverKind: draft.coverKind,
        coverRef: draft.coverRef,
        coverMeta: draft.coverMeta,
        questions: draft.questions.map((question) => ({
          prompt: question.prompt,
          description: question.description ?? "",
          pickType: question.pickType,
          maxPicks: question.maxPicks,
          options: question.options.map((option) => ({
            label: option.label === "Untitled option" ? "" : option.label,
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
    }
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:py-10">
        <Link
          href="/discover"
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ← Discover quizzes
        </Link>
        <div className="mt-4">
          <Wizard initial={initial} />
        </div>
      </div>
    </main>
  );
}
