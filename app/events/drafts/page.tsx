import Link from "next/link";
import { headers } from "next/headers";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { events } from "@/db/schema/app";
import SignInButton from "../new/_components/sign-in-button";

export default async function DraftsPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    return (
      <main className="min-h-dvh bg-background text-foreground">
        <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
          <div className="rounded-xl border border-border bg-surface-1 p-6 text-center sm:p-8">
            <h1 className="text-balance text-2xl font-bold">Sign in to see your drafts</h1>
            <p className="mx-auto mt-2 max-w-sm text-pretty text-sm leading-5 text-muted-foreground">
              Drafts belong to the account that created them.
            </p>
            <div className="mt-5">
              <SignInButton callbackURL="/events/drafts" label="Continue with Google" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  const drafts = await db.query.events.findMany({
    where: and(eq(events.creatorUserId, session.user.id), eq(events.status, "draft")),
    orderBy: [desc(events.updatedAt)],
  });

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
          <h1 className="text-balance text-3xl font-bold">My drafts</h1>
          <Link
            href="/events/new"
            className="rounded-md bg-accent-hover px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            New poll
          </Link>
        </div>

        {drafts.length === 0 ? (
          <div className="mt-6 rounded-xl border border-border bg-surface-1 p-6 text-center sm:p-8">
            <h2 className="text-balance text-xl font-bold">No drafts yet</h2>
            <p className="mx-auto mt-2 max-w-sm text-pretty text-sm leading-5 text-muted-foreground">
              Start a poll and save it as a draft at any step — it will wait for you here.
            </p>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {drafts.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-1 p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-base font-bold text-foreground">
                    {d.title.trim() === "" ? "Untitled poll" : d.title}
                  </p>
                  <p className="mt-0.5 font-mono text-xs tabular-nums text-subtle-foreground">
                    Edited{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(d.updatedAt)}
                  </p>
                </div>
                <Link
                  href={`/events/new?draft=${d.id}`}
                  className="shrink-0 rounded-md border border-border bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Resume
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
