import { Suspense } from "react";
import HomePollList from "./home-poll-list";
import HomePollSkeleton from "./home-poll-skeleton";
import DiscoverStatusTabs from "./discover-status-tabs";

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

        <div className="mt-6">
          <DiscoverStatusTabs view={view}>
            <Suspense fallback={<HomePollSkeleton />}>
              <HomePollList view={view} />
            </Suspense>
          </DiscoverStatusTabs>
        </div>
      </div>
    </main>
  );
}
