"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { cn } from "@/lib/cn";

type ViewState =
  | "default"
  | "voting"
  | "voted"
  | "closed"
  | "loading"
  | "empty"
  | "error";

type MockOption = {
  id: string;
  label: string;
  description: string | null;
  image: { src: string; alt: string } | null;
  votes: number;
};

const CLOSE_DATE = new Date("2026-10-02T20:14:00");
const SHARE_URL = "pickem.app/events/afc-north-2026?view=live";

const BASE_OPTIONS: MockOption[] = [
  {
    id: "ravens",
    label: "Ravens",
    description:
      "Lamar Jackson and the league’s most balanced roster, favored at home down the stretch.",
    image: {
      src: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' rx='18' fill='%23E8DCCD'/%3E%3Ctext x='48' y='62' font-family='Georgia,serif' font-size='44' font-weight='bold' text-anchor='middle' fill='%232B2722'%3ER%3C/text%3E%3C/svg%3E",
      alt: "Ravens team logo",
    },
    votes: 1284,
  },
  {
    id: "bengals",
    label: "Bengals",
    description: null,
    image: {
      src: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' rx='18' fill='%23F0E7DC'/%3E%3Ctext x='48' y='62' font-family='Georgia,serif' font-size='44' font-weight='bold' text-anchor='middle' fill='%232B2722'%3EB%3C/text%3E%3C/svg%3E",
      alt: "Bengals team logo",
    },
    votes: 786,
  },
  {
    id: "steelers",
    label: "Steelers",
    description: null,
    image: null,
    votes: 0,
  },
];

const SWITCHER_STATES: { id: ViewState; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "voting", label: "Pressed / voting" },
  { id: "voted", label: "Already voted" },
  { id: "closed", label: "Closed" },
  { id: "loading", label: "Loading" },
  { id: "empty", label: "Empty" },
  { id: "error", label: "Error" },
];

function formatInt(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPct(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCloseDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path
        d="m5 13 4 4L19 7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LiveIndicator() {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref);
  const reduceMotion = useReducedMotion();

  return (
    <span
      ref={ref}
      className="inline-flex items-center gap-2 rounded-sm border border-accent px-3 py-1 text-sm font-medium text-accent"
    >
      <motion.span
        aria-hidden="true"
        className="size-2 rounded-full bg-accent"
        initial="static"
        animate={inView && !reduceMotion ? "pulse" : "static"}
        variants={{
          static: { opacity: 1 },
          pulse: { opacity: [1, 0.35, 1] },
        }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      />
      Vote is live
    </span>
  );
}

function ResultBar({ pct, highlight }: { pct: number; highlight: boolean }) {
  const reduceMotion = useReducedMotion();
  const pctValue = useMotionValue(pct);
  const scaleX = useTransform(pctValue, (v) => Math.min(Math.max(v, 0), 100) / 100);

  useEffect(() => {
    const controls = animate(pctValue, pct, {
      duration: reduceMotion ? 0 : 0.16,
      ease: "easeOut",
    });
    return () => controls.stop();
  }, [pctValue, pct, reduceMotion]);

  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
      <motion.div
        className={cn(
          "h-full w-full origin-left",
          highlight ? "bg-accent" : "bg-foreground/30",
        )}
        style={{ scaleX }}
      />
    </div>
  );
}

function OptionSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-center gap-3">
        <div className="size-12 rounded-md bg-surface-3" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-1/3 rounded-sm bg-surface-3" />
          <div className="h-3 w-2/3 rounded-sm bg-surface-3" />
        </div>
        <div className="h-6 w-12 rounded-sm bg-surface-3" />
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-surface-3" />
    </div>
  );
}

export default function EventDetailPage() {
  const [view, setView] = useState<ViewState>("default");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const reduceMotion = useReducedMotion();

  const pressProps = reduceMotion
    ? {}
    : { whileTap: { scale: 0.98 }, transition: { duration: 0.12 } };

  function switchView(next: ViewState) {
    setView(next);
    setCopied(false);
    if (next === "voting" || next === "voted") {
      setSelectedId("ravens");
    } else if (next === "default") {
      setSelectedId(null);
    }
  }

  const isOpen = view === "default" || view === "voting" || view === "voted";
  const locked = view === "voting" || view === "voted" || view === "closed";

  const options =
    view === "voted"
      ? BASE_OPTIONS.map((o) =>
          o.id === "ravens" ? { ...o, votes: o.votes + 1 } : o,
        )
      : BASE_OPTIONS;
  const totalVotes = options.reduce((sum, o) => sum + o.votes, 0);
  const leaderId =
    totalVotes === 0
      ? null
      : options.reduce((a, b) => (b.votes > a.votes ? b : a)).id;
  const selected = options.find((o) => o.id === selectedId) ?? null;

  const announcement =
    view === "voted"
      ? "Your pick was recorded for Ravens."
      : view === "closed"
        ? "Voting is closed. Final results are shown."
        : selected
          ? `${selected.label} selected, ${formatPct(selected.votes / Math.max(totalVotes, 1))} of votes.`
          : "No option selected yet.";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`https://${SHARE_URL}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      {process.env.NODE_ENV !== "production" ? (
        <div
          data-testid="dev-state-switcher"
          className="border-b border-border bg-surface-1"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
            <p className="mr-2 text-xs font-medium uppercase text-subtle-foreground">
              Dev state switcher
            </p>
            {SWITCHER_STATES.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={view === s.id}
                onClick={() => switchView(s.id)}
                className={cn(
                  "rounded-sm border px-3 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  view === s.id
                    ? "border-accent bg-accent-hover text-accent-foreground"
                    : "border-border bg-surface-1 text-muted-foreground hover:border-accent hover:text-accent",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <Link
              href="/"
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              ← All polls
            </Link>

            {view === "loading" ? (
              <div className="mt-5 space-y-3" aria-live="polite">
                <p className="text-sm font-medium text-muted-foreground">
                  Loading poll…
                </p>
                <div className="h-9 w-2/3 rounded-md bg-surface-3" />
                <div className="h-5 w-full rounded-sm bg-surface-3" />
                <div className="h-5 w-5/6 rounded-sm bg-surface-3" />
              </div>
            ) : view === "error" ? (
              <div className="mt-5 rounded-lg border border-border bg-surface-1 p-5">
                <h1 className="text-balance text-2xl font-bold">
                  Couldn’t load this poll
                </h1>
                <p
                  className="mt-2 text-pretty text-sm leading-5 text-muted-foreground"
                  aria-live="polite"
                >
                  The poll data failed to load. Check your connection and try
                  again — your previous votes are unaffected.
                </p>
                <button
                  type="button"
                  onClick={() => switchView("default")}
                  className="mt-4 rounded-md bg-accent-hover px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Retry
                </button>
              </div>
            ) : (
              <>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <span className="rounded-sm border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Unlisted
                  </span>
                  {isOpen ? (
                    <LiveIndicator />
                  ) : (
                    <span className="rounded-sm border border-border px-3 py-1 text-sm font-medium text-muted-foreground">
                      Voting closed
                    </span>
                  )}
                </div>

                <h1 className="mt-3 text-balance text-3xl font-bold leading-10 sm:text-4xl sm:leading-[3rem]">
                  Who takes the AFC North?
                </h1>
                <p className="mt-3 max-w-2xl text-pretty text-base leading-6 text-muted-foreground">
                  Pick the team you think finishes the regular season on top of
                  the division. One vote per person — choose carefully, votes
                  can’t be changed once cast.
                </p>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm tabular-nums">
                  <span className="text-foreground">
                    {formatInt(totalVotes)} votes
                  </span>
                  <span className="text-subtle-foreground">
                    {isOpen ? "Closes in 08:14" : "Closed"} ·{" "}
                    {formatCloseDate(CLOSE_DATE)}
                  </span>
                </div>
              </>
            )}

            {view !== "loading" && view !== "error" && (
              <p aria-live="polite" className="sr-only">
                {announcement}
              </p>
            )}

            <div className="mt-6">
              {view === "loading" ? (
                <div className="space-y-3">
                  <OptionSkeleton />
                  <OptionSkeleton />
                  <OptionSkeleton />
                </div>
              ) : view === "empty" ? (
                <div className="rounded-lg border border-border bg-surface-1 p-6 text-center">
                  <h2 className="text-balance text-xl font-bold">
                    No options yet
                  </h2>
                  <p className="mx-auto mt-2 max-w-sm text-pretty text-sm leading-5 text-muted-foreground">
                    The creator hasn’t added any options to this poll. Check
                    back later, or browse polls that are already live.
                  </p>
                  <Link
                    href="/"
                    className="mt-4 inline-block rounded-md bg-accent-hover px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Browse live polls
                  </Link>
                </div>
              ) : view === "error" ? null : (
                <ul className="space-y-3">
                  {options.map((option) => {
                    const pct =
                      totalVotes === 0 ? 0 : option.votes / totalVotes;
                    const isSelected = selectedId === option.id;
                    const cardClass = cn(
                      "flex w-full items-center gap-3 rounded-lg border bg-surface-1 p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                      isSelected
                        ? "border-accent"
                        : "border-border hover:border-accent",
                    );
                    const body = (
                      <>
                        {option.image ? (
                          <img
                            src={option.image.src}
                            alt={option.image.alt}
                            width={48}
                            height={48}
                            className="size-12 shrink-0 rounded-md border border-border"
                          />
                        ) : null}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-base font-bold text-foreground">
                              {option.label}
                            </span>
                            {isSelected ? (
                              <motion.span
                                aria-hidden="true"
                                className="text-accent"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{
                                  duration: reduceMotion ? 0 : 0.12,
                                  ease: "easeOut",
                                }}
                              >
                                <CheckIcon />
                              </motion.span>
                            ) : null}
                          </span>
                          {option.description ? (
                            <span className="mt-0.5 line-clamp-2 block text-sm leading-5 text-muted-foreground">
                              {option.description}
                            </span>
                          ) : null}
                          <span className="mt-2 block">
                            <ResultBar
                              pct={pct * 100}
                              highlight={leaderId === option.id}
                            />
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block font-mono text-xl font-bold tabular-nums text-foreground">
                            {formatPct(pct)}
                          </span>
                          <span className="block font-mono text-xs tabular-nums text-muted-foreground">
                            {formatInt(option.votes)}
                          </span>
                        </span>
                      </>
                    );
                    return (
                      <li key={option.id}>
                        {locked ? (
                          <div
                            className={cardClass}
                            aria-current={isSelected ? "true" : undefined}
                          >
                            {body}
                          </div>
                        ) : (
                          <motion.button
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() =>
                              setSelectedId(isSelected ? null : option.id)
                            }
                            className={cardClass}
                            {...pressProps}
                          >
                            {body}
                          </motion.button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <aside className="lg:pt-16">
            <div className="rounded-xl border border-border bg-surface-1 p-5">
              <h2 className="text-balance text-lg font-bold">Results</h2>
              {view === "loading" ? (
                <div className="mt-3 space-y-2" aria-live="polite">
                  <div className="h-4 w-1/2 rounded-sm bg-surface-3" />
                  <div className="h-4 w-2/3 rounded-sm bg-surface-3" />
                </div>
              ) : view === "error" ? (
                <p className="mt-3 text-pretty text-sm leading-5 text-muted-foreground">
                  Results unavailable while the poll fails to load.
                </p>
              ) : (
                <>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Total votes</dt>
                      <dd className="font-mono font-bold tabular-nums text-foreground">
                        {view === "empty" ? "—" : formatInt(totalVotes)}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Status</dt>
                      <dd className="font-medium text-foreground">
                        {view === "closed"
                          ? "Closed · final"
                          : view === "voted"
                            ? "Open · you voted"
                            : "Open"}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Closes</dt>
                      <dd className="font-mono tabular-nums text-foreground">
                        {formatCloseDate(CLOSE_DATE)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex items-center gap-2 rounded-md border border-border bg-mono-surface p-2 pl-3">
                    <p className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums text-muted-foreground">
                      {SHARE_URL}
                    </p>
                    <button
                      type="button"
                      onClick={copyLink}
                      aria-label="Copy poll link"
                      className="shrink-0 rounded-sm border border-border bg-surface-1 px-2 py-1 font-mono text-xs text-muted-foreground hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      </div>

      {view !== "loading" && view !== "error" && view !== "empty" && (
        <div className="sticky bottom-0 border-t border-border bg-background lg:static lg:border-t-0 lg:bg-transparent">
          <div className="mx-auto w-full max-w-6xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 lg:px-6 lg:pb-10 lg:pt-0">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p aria-live="polite" className="text-sm text-muted-foreground">
                {view === "voted"
                  ? "Your pick: Ravens · thanks for voting."
                  : view === "closed"
                    ? "Voting has closed — results above are final."
                    : selected
                      ? `Ready to vote for ${selected.label}.`
                      : "Select an option above to vote."}
              </p>
              {view === "voted" ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex cursor-not-allowed items-center gap-2 rounded-md bg-surface-3 px-5 py-2.5 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <CheckIcon />
                  Vote recorded · Ravens
                </button>
              ) : view === "closed" ? (
                <button
                  type="button"
                  disabled
                  className="cursor-not-allowed rounded-md bg-surface-3 px-5 py-2.5 text-sm font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Voting closed
                </button>
              ) : view === "voting" ? (
                <motion.button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="cursor-wait rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  initial={{ scale: 1 }}
                  animate={{ scale: 0.98 }}
                  transition={{ duration: reduceMotion ? 0 : 0.12 }}
                >
                  Casting vote…
                </motion.button>
              ) : (
                <motion.button
                  type="button"
                  disabled={!selected}
                  onClick={() => selected && switchView("voting")}
                  className={cn(
                    "rounded-md px-5 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    selected
                      ? "bg-accent-hover text-accent-foreground hover:bg-accent"
                      : "cursor-not-allowed bg-surface-3 text-muted-foreground",
                  )}
                  {...pressProps}
                >
                  Cast vote
                </motion.button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
