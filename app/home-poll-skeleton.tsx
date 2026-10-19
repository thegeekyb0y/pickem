export default function HomePollSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading polls" className="space-y-8">
      <span className="sr-only">Loading polls</span>
      {[0, 1, 2].map((section) => (
        <section key={section} aria-hidden="true">
          <div className="mb-3 h-7 w-40 rounded-sm bg-surface-3" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((card) => (
              <div
                key={card}
                className="min-h-48 rounded-lg border border-border bg-surface-1 p-5"
              >
                <div className="h-4 w-24 rounded-sm bg-surface-3" />
                <div className="mt-4 h-6 w-3/4 rounded-sm bg-surface-3" />
                <div className="mt-3 h-4 w-full rounded-sm bg-surface-3" />
                <div className="mt-2 h-4 w-2/3 rounded-sm bg-surface-3" />
                <div className="mt-6 h-4 w-1/2 rounded-sm bg-surface-3" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
