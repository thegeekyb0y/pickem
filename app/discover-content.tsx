import Link from "next/link";
import { Suspense } from "react";
import HomePollList from "./home-poll-list";
import HomePollSkeleton from "./home-poll-skeleton";

export default function DiscoverContent({ view }: { view: "live" | "closed" }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground sm:px-6 lg:py-10">
      <div className="mx-auto w-full max-w-6xl">
        <header className="rounded-xl border border-border bg-surface-1 p-5 sm:p-7">
          <p className="text-sm font-medium text-accent">Pickem</p>
          <h1 className="mt-2 text-balance text-3xl font-bold sm:text-4xl">
            Discover quizzes
          </h1>
          <p className="mt-2 max-w-2xl text-pretty text-base leading-6 text-muted-foreground">
            Answer questions, follow results, and share a quiz with your group.
          </p>
        </header>

        <nav aria-label="Quiz status" className="mt-6 flex gap-2 border-b border-border">
          <Link
            href="/discover"
            aria-current={view === "live" ? "page" : undefined}
            className={`rounded-t-md border-b-2 px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              view === "live"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Live &amp; upcoming
          </Link>
          <Link
            href="/discover?view=closed"
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
