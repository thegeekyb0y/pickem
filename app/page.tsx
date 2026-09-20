const matchup = [
  { team: "Ravens", votes: 1284, pct: 62 },
  { team: "Bengals", votes: 786, pct: 38 },
];

const leaders = [
  { name: "Mina", points: 148, accuracy: 68, streak: 7 },
  { name: "Dev", points: 141, accuracy: 64, streak: 5 },
  { name: "Jordan", points: 136, accuracy: 61, streak: 4 },
];

function TokenSwatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-surface-1 p-3">
      <div className={`size-9 rounded-sm border border-border ${className}`} />
      <span className="text-sm font-medium text-foreground">{name}</span>
    </div>
  );
}

function IconBolt() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        d="M13 2 4 14h7l-1 8 10-13h-7l1-7Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PreviewCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface-1 p-5 shadow-none sm:p-6">
      <div className="mb-5 space-y-1">
        <p className="text-xs font-medium uppercase text-subtle-foreground">
          {eyebrow}
        </p>
        <h2 className="text-balance text-xl font-bold leading-8 text-foreground">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

export default function Home() {
  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-5 rounded-xl border border-border bg-surface-1 p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-4">
            <p className="text-sm font-medium text-accent">Pickem Token System</p>
            <h1 className="text-balance text-4xl font-bold leading-[3rem] text-foreground">
              Warm Paper, Live Voting, Restrained Hierarchy
            </h1>
            <p className="text-pretty text-base leading-6 text-muted-foreground">
              Five static previews for the Pickem interface tokens: warm neutral
              surfaces, copper live-state accent, tabular numeric data, measured
              borders, structural loading states, and motion constrained to
              opacity or transform.
            </p>
          </div>
          <div className="rounded-md border border-border bg-mono-surface px-4 py-3 font-mono text-sm tabular-nums text-foreground">
            Week 03 · 12:48 PM
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <PreviewCard eyebrow="Preview 01" title="Live Matchup Card">
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    AFC North
                  </p>
                  <p className="font-mono text-sm tabular-nums text-subtle-foreground">
                    Closes In 08:14
                  </p>
                </div>
                <span className="inline-flex items-center gap-2 rounded-sm border border-accent px-3 py-1 text-sm font-medium text-accent">
                  <IconBolt />
                  Vote Is Live
                </span>
              </div>

              <div className="grid gap-3">
                {matchup.map((pick) => (
                  <button
                    key={pick.team}
                    type="button"
                    className="group flex items-center justify-between rounded-md border border-border bg-surface-2 p-4 text-left hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span>
                      <span className="block text-lg font-bold text-foreground">
                        {pick.team}
                      </span>
                      <span className="font-mono text-sm tabular-nums text-muted-foreground">
                        {new Intl.NumberFormat("en-US").format(pick.votes)} votes
                      </span>
                    </span>
                    <span className="font-mono text-2xl font-bold tabular-nums text-foreground">
                      {new Intl.NumberFormat("en-US", {
                        style: "percent",
                        maximumFractionDigits: 0,
                      }).format(pick.pct / 100)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </PreviewCard>

          <PreviewCard eyebrow="Preview 02" title="Palette & Type Tokens">
            <div className="grid gap-3">
              <TokenSwatch name="Background" className="bg-background" />
              <TokenSwatch name="Surface 1" className="bg-surface-1" />
              <TokenSwatch name="Surface 2" className="bg-surface-2" />
              <TokenSwatch name="Surface 3" className="bg-surface-3" />
              <TokenSwatch name="Accent" className="bg-accent" />
              <div className="rounded-md border border-border bg-mono-surface p-4 font-mono text-sm tabular-nums text-foreground">
                1,284 · 62% · +110 · 08:14
              </div>
            </div>
          </PreviewCard>

          <PreviewCard eyebrow="Preview 03" title="Leaderboard Data Table">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] border-separate border-spacing-0 text-left text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="border-b border-border pb-3 font-medium">Player</th>
                    <th className="border-b border-border pb-3 text-right font-medium">
                      Points
                    </th>
                    <th className="border-b border-border pb-3 text-right font-medium">
                      Accuracy
                    </th>
                    <th className="border-b border-border pb-3 text-right font-medium">
                      Streak
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leaders.map((leader) => (
                    <tr key={leader.name}>
                      <td className="border-b border-border py-3 font-medium text-foreground">
                        {leader.name}
                      </td>
                      <td className="border-b border-border py-3 text-right font-mono tabular-nums text-foreground">
                        {new Intl.NumberFormat("en-US").format(leader.points)}
                      </td>
                      <td className="border-b border-border py-3 text-right font-mono tabular-nums text-foreground">
                        {new Intl.NumberFormat("en-US", {
                          style: "percent",
                          maximumFractionDigits: 0,
                        }).format(leader.accuracy / 100)}
                      </td>
                      <td className="border-b border-border py-3 text-right font-mono tabular-nums text-foreground">
                        {leader.streak}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PreviewCard>

          <PreviewCard eyebrow="Preview 04" title="Empty & Loading States">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-md border border-border bg-surface-2 p-4">
                <h3 className="text-base font-bold text-foreground">No Picks Yet</h3>
                <p className="mt-2 text-pretty text-sm leading-5 text-muted-foreground">
                  Start with the live board and make your first pick before the
                  window closes.
                </p>
                <button
                  type="button"
                  className="mt-4 rounded-md bg-accent-hover px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  View Live Board
                </button>
              </div>
              <div className="rounded-md border border-border bg-surface-2 p-4" aria-live="polite">
                <p className="mb-3 text-sm font-medium text-muted-foreground">
                  Loading Picks…
                </p>
                <div className="space-y-3">
                  <div className="h-4 w-3/4 rounded-sm bg-surface-3" />
                  <div className="h-4 w-full rounded-sm bg-surface-3" />
                  <div className="h-10 w-full rounded-md bg-surface-3" />
                </div>
              </div>
            </div>
          </PreviewCard>

          <PreviewCard eyebrow="Preview 05" title="Confirmation & URL State">
            <div className="space-y-4">
              <div
                role="dialog"
                aria-labelledby="reset-picks-title"
                className="rounded-lg border border-border bg-surface-1 p-4 shadow-popover"
              >
                <h3 id="reset-picks-title" className="text-lg font-bold text-foreground">
                  Reset All Picks?
                </h3>
                <p className="mt-2 text-pretty text-sm leading-5 text-muted-foreground">
                  This destructive action needs an AlertDialog-style confirmation
                  or an undo window before it can run.
                </p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    className="rounded-md border border-border bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-accent-hover px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Reset Picks
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-mono-surface p-3">
                <p className="min-w-0 truncate font-mono text-sm tabular-nums text-muted-foreground">
                  ?week=3&amp;view=live&amp;expanded=ravens-bengals
                </p>
                <button
                  type="button"
                  aria-label="Copy URL state"
                  className="grid size-9 place-items-center rounded-sm border border-border bg-surface-1 text-muted-foreground hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <svg
                    aria-hidden="true"
                    className="size-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      d="M8 8h10v10H8z M6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </PreviewCard>
        </div>
      </div>
    </main>
  );
}
