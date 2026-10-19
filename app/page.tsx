import Link from "next/link";
import { Suspense } from "react";
import HomePollList from "./home-poll-list";
import HomePollSkeleton from "./home-poll-skeleton";

export default async function Home({
  searchParams,
}: PageProps<"/">) {
  const params = await searchParams;
  const view = params.view === "closed" ? "closed" : "live";

  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground sm:px-6 lg:py-10">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-col gap-5 rounded-xl border border-border bg-surface-1 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-accent">Pickem</p>
            <h1 className="mt-2 text-balance text-3xl font-bold sm:text-4xl">
              Discover polls
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-base leading-6 text-muted-foreground">
              Make a pick, follow the results, and share a poll with your group.
            </p>
          </div>
          <nav aria-label="Poll actions" className="flex flex-wrap gap-2">
            <Link
              href="/events/drafts"
              className="rounded-md border border-border bg-surface-1 px-4 py-2.5 text-sm font-medium text-foreground hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              My drafts
            </Link>
            <Link
              href="/events/new"
              className="rounded-md bg-accent-hover px-4 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              New poll
            </Link>
          </nav>
        </header>

        <nav aria-label="Poll status" className="mt-6 flex gap-2 border-b border-border">
          <Link
            href="/"
            aria-current={view === "live" ? "page" : undefined}
            className={`rounded-t-md border-b-2 px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              view === "live"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Live & upcoming
          </Link>
          <Link
            href="/?view=closed"
            aria-current={view === "closed" ? "page" : undefined}
            className={`rounded-t-md border-b-2 px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              view === "closed"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Closed
          </Link>
        </nav>

        <div className="mt-6">
          <Suspense fallback={<HomePollSkeleton />}>
            <HomePollList view={view} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
