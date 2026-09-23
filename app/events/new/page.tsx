import Link from "next/link";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { events } from "@/db/schema/app";
import Wizard, { type WizardInitial } from "./_components/wizard";
import SignInButton from "./_components/sign-in-button";

function toLocalInput(value: Date) {
  return value.toISOString().slice(0, 16);
}

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string; step?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    return (
      <main className="min-h-dvh bg-background text-foreground">
        <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
          <Link
            href="/"
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ← All polls
          </Link>
          <div className="mt-5 rounded-xl border border-border bg-surface-1 p-6 text-center sm:p-8">
            <h1 className="text-balance text-2xl font-bold">Sign in to create a poll</h1>
            <p className="mx-auto mt-2 max-w-sm text-pretty text-sm leading-5 text-muted-foreground">
              Poll creation needs a Google account so your polls have a real owner.
              Voting itself stays open to everyone.
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
    step: 1,
    title: "",
    description: "",
    opensAt: "",
    closesAt: "",
    visibility: "unlisted",
    options: [],
  };

  if (params.draft) {
    const draft = await db.query.events.findFirst({
      where: eq(events.id, params.draft),
      with: { options: { orderBy: (t, { asc }) => [asc(t.sortOrder)] } },
    });
    if (draft && draft.creatorUserId === session.user.id && draft.status === "draft") {
      initial = {
        eventId: draft.id,
        step: draft.draftStep === 2 || draft.draftStep === 3 ? draft.draftStep : 1,
        title: draft.title === "Untitled poll" ? "" : draft.title,
        description: draft.description ?? "",
        opensAt: toLocalInput(draft.opensAt),
        closesAt: toLocalInput(draft.closesAt),
        visibility: draft.visibility,
        options: draft.options.map((o) => ({
          label: o.label.startsWith("Untitled option") ? "" : o.label,
          description: o.description ?? "",
          showDetails: (o.description ?? "") !== "",
          showImage: o.imageUrl != null,
          imageMode: o.imageSource === "external_url" ? "link" : "upload",
          imageUrl: o.imageUrl ?? "",
          imageBlobKey: o.imageBlobKey ?? "",
          imageAlt: o.imageAlt ?? "",
          linkDraft: o.imageSource === "external_url" ? (o.imageUrl ?? "") : "",
        })),
      };
    }
  }

  const requestedStep = Number(params.step);
  if (requestedStep === 2 || requestedStep === 3) {
    initial = { ...initial, step: requestedStep };
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 lg:py-10">
        <Link
          href="/"
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ← All polls
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-balance text-3xl font-bold">
            {initial.eventId ? "Finish your poll" : "Create a poll"}
          </h1>
          <Link
            href="/events/drafts"
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            My drafts
          </Link>
        </div>
        <div className="mt-6">
          <Wizard initial={initial} />
        </div>
      </div>
    </main>
  );
}
