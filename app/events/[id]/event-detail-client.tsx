"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { submitVote } from "@/lib/events/voting";
import ShareButton from "./share-button";

type EventData = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  visibility: string;
  pickType: "single" | "top_n";
  maxPicks: number;
  opensAt: string;
  closesAt: string;
};

type OptionData = {
  id: string;
  label: string;
  description: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
};

type SelectionCount = { optionId: string; count: number };

function numberFormat(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function percentFormat(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value);
}

function dateFormat(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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
      <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function EventDetailClient({
  event,
  options,
  selectionCounts,
  totalBallots,
  initialVoteIds,
  isLoggedIn,
  notStarted,
  isClosed,
}: {
  event: EventData;
  options: OptionData[];
  selectionCounts: SelectionCount[];
  totalBallots: number;
  initialVoteIds: string[];
  isLoggedIn: boolean;
  notStarted: boolean;
  isClosed: boolean;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [selectedIds, setSelectedIds] = useState(initialVoteIds);
  const [hasVoted, setHasVoted] = useState(initialVoteIds.length > 0);
  const [guestHandle, setGuestHandle] = useState("");
  const [guestPlatform, setGuestPlatform] = useState<"instagram" | "x">("instagram");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const counts = useMemo(
    () => new Map(selectionCounts.map((selection) => [selection.optionId, selection.count])),
    [selectionCounts],
  );
  const selectionLimit = event.pickType === "single" ? 1 : event.maxPicks;
  const canVote = !isClosed && !hasVoted && options.length > 0;

  function toggleOption(optionId: string) {
    if (!canVote || pending) return;
    setError(null);
    setSelectedIds((current) => {
      if (current.includes(optionId)) {
        return current.filter((id) => id !== optionId);
      }
      if (current.length >= selectionLimit) return current;
      return [...current, optionId];
    });
  }

  async function castVote() {
    if (selectedIds.length < 1 || selectedIds.length > selectionLimit) {
      setError(
        event.pickType === "single"
          ? "Choose one option before submitting."
          : `Choose between one and ${event.maxPicks} options, in order.`,
      );
      return;
    }
    if (!isLoggedIn && guestHandle.trim() === "") {
      setError("Enter your Instagram or X handle to submit as a guest.");
      document.getElementById("guest-handle")?.focus();
      return;
    }

    setPending(true);
    setError(null);
    const result = await submitVote({
      eventId: event.id,
      optionIds: selectedIds,
      guestHandle: isLoggedIn ? undefined : guestHandle,
      guestHandlePlatform: isLoggedIn ? undefined : guestPlatform,
    });
    setPending(false);

    if (result.ok) {
      setHasVoted(true);
      router.refresh();
    } else {
      setError(result.message);
      if (result.reason === "already-voted") router.refresh();
    }
  }

  const chosenNames = selectedIds
    .map((id) => options.find((option) => option.id === id)?.label)
    .filter((label): label is string => Boolean(label));

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-10">
        <Link
          href="/"
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ← All polls
        </Link>

        <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-sm border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {event.visibility === "discoverable" ? "Discoverable" : "Unlisted"}
              </span>
              {!isClosed ? (
                <span className="inline-flex items-center gap-2 rounded-sm border border-accent px-3 py-1 text-sm font-medium text-accent">
                  <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
                  Voting open
                </span>
              ) : (
                <span className="rounded-sm border border-border px-3 py-1 text-sm font-medium text-muted-foreground">
                  {notStarted ? "Not open yet" : "Voting closed"}
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-balance text-3xl font-bold leading-10 sm:text-4xl sm:leading-[3rem]">
                {event.title}
              </h1>
              <ShareButton title={event.title} />
            </div>
            {event.description ? (
              <p className="mt-3 max-w-2xl text-pretty text-base leading-6 text-muted-foreground">
                {event.description}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm tabular-nums">
              <span className="text-foreground">
                {numberFormat(totalBallots)} {totalBallots === 1 ? "ballot" : "ballots"}
              </span>
              <span className="text-subtle-foreground">
                {notStarted
                  ? `Opens ${dateFormat(event.opensAt)}`
                  : `Closes ${dateFormat(event.closesAt)}`}
              </span>
            </div>

            <div className="mt-6">
              {options.length === 0 ? (
                <div className="rounded-lg border border-border bg-surface-1 p-6">
                  <h2 className="text-balance text-xl font-bold">No options yet</h2>
                  <p className="mt-2 text-pretty text-sm leading-5 text-muted-foreground">
                    The poll creator hasn’t added any options.
                  </p>
                </div>
              ) : (
                <ul className="space-y-3" aria-label="Poll options">
                  {options.map((option) => {
                    const selectionIndex = selectedIds.indexOf(option.id);
                    const selected = selectionIndex >= 0;
                    const count = counts.get(option.id) ?? 0;
                    const share = totalBallots === 0 ? 0 : count / totalBallots;
                    const disabled =
                      !canVote ||
                      pending ||
                      (!selected && selectedIds.length >= selectionLimit);
                    return (
                      <li key={option.id}>
                        <motion.button
                          type="button"
                          aria-pressed={selected}
                          aria-label={
                            event.pickType === "top_n"
                              ? `${option.label}${selected ? `, rank ${selectionIndex + 1}` : ""}`
                              : option.label
                          }
                          disabled={disabled}
                          onClick={() => toggleOption(option.id)}
                          whileTap={reduceMotion || disabled ? undefined : { scale: 0.99 }}
                          transition={{ duration: reduceMotion ? 0 : 0.12, ease: "easeOut" }}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg border bg-surface-1 p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                            selected ? "border-accent bg-surface-2" : "border-border",
                            canVote && !disabled && "hover:border-accent",
                            disabled && !selected && "opacity-80",
                          )}
                        >
                          {option.imageUrl ? (
                            <Image
                              src={option.imageUrl}
                              alt={option.imageAlt ?? option.label}
                              width={48}
                              height={48}
                              unoptimized
                              className="size-12 shrink-0 rounded-md border border-border object-cover"
                            />
                          ) : null}

                          {event.pickType === "top_n" ? (
                            <span
                              aria-hidden="true"
                              className={cn(
                                "grid size-8 shrink-0 place-items-center rounded-full border font-mono text-sm font-bold tabular-nums",
                                selected
                                  ? "border-accent bg-accent text-accent-foreground"
                                  : "border-border text-subtle-foreground",
                              )}
                            >
                              {selected ? selectionIndex + 1 : "—"}
                            </span>
                          ) : selected ? (
                            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
                              <CheckIcon />
                            </span>
                          ) : null}

                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-base font-bold text-foreground">
                              {option.label}
                            </span>
                            {option.description ? (
                              <span className="mt-0.5 line-clamp-2 block text-sm leading-5 text-muted-foreground">
                                {option.description}
                              </span>
                            ) : null}
                            <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-3">
                              <span
                                className={cn(
                                  "block h-full origin-left",
                                  selected ? "bg-accent" : "bg-foreground/30",
                                )}
                                style={{ transform: `scaleX(${Math.min(share, 1)})` }}
                              />
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block font-mono text-xl font-bold tabular-nums text-foreground">
                              {percentFormat(share)}
                            </span>
                            <span className="block font-mono text-xs tabular-nums text-muted-foreground">
                              {numberFormat(count)} {event.pickType === "top_n" ? "picked" : "votes"}
                            </span>
                          </span>
                        </motion.button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <p aria-live="polite" className="sr-only">
              {hasVoted
                ? "Your ballot is final and has been submitted."
                : event.pickType === "top_n"
                  ? `${selectedIds.length} of up to ${event.maxPicks} picks selected. Order is selection order.`
                  : selectedIds.length === 1
                    ? `${chosenNames[0]} selected.`
                    : "No option selected."}
            </p>

            {!isLoggedIn && canVote && !hasVoted ? (
              <div className="mt-5 grid gap-3 rounded-lg border border-border bg-surface-1 p-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <div>
                  <label htmlFor="guest-handle" className="mb-1 block text-sm font-medium">
                    Social handle
                  </label>
                  <input
                    id="guest-handle"
                    name="guestHandle"
                    type="text"
                    autoComplete="nickname"
                    maxLength={40}
                    placeholder="Your Instagram or X handle"
                    value={guestHandle}
                    onChange={(e) => setGuestHandle(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used as the label on this ballot only.
                  </p>
                </div>
                <div>
                  <label htmlFor="guest-platform" className="mb-1 block text-sm font-medium">
                    Platform
                  </label>
                  <select
                    id="guest-platform"
                    name="guestPlatform"
                    value={guestPlatform}
                    onChange={(e) => setGuestPlatform(e.target.value as "instagram" | "x")}
                    className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <option value="instagram">Instagram</option>
                    <option value="x">X</option>
                  </select>
                </div>
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="mt-4 rounded-md border border-border bg-surface-1 p-3 text-sm text-accent">
                {error}
              </p>
            ) : null}
          </section>

          <aside className="lg:pt-0">
            <div className="rounded-xl border border-border bg-surface-1 p-5">
              <h2 className="text-balance text-lg font-bold">
                {event.pickType === "top_n" ? "Pick summary" : "Results"}
              </h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Ballots</dt>
                  <dd className="font-mono font-bold tabular-nums text-foreground">
                    {numberFormat(totalBallots)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Pick format</dt>
                  <dd className="font-medium text-foreground">
                    {event.pickType === "single" ? "Single choice" : `Top ${event.maxPicks}`}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Closes</dt>
                  <dd className="font-mono tabular-nums text-foreground">
                    {dateFormat(event.closesAt)}
                  </dd>
                </div>
              </dl>
              {event.pickType === "top_n" ? (
                <p className="mt-4 border-t border-border pt-3 text-pretty text-xs leading-5 text-muted-foreground">
                  Selection percentages show how many ballots included each option.
                  Final prediction scoring will be defined separately after results are known.
                </p>
              ) : null}
            </div>
          </aside>
        </div>
      </div>

      {!hasVoted && !isClosed ? (
        <div className="sticky bottom-0 border-t border-border bg-background">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-sm text-muted-foreground">
              {event.pickType === "top_n"
                ? `${selectedIds.length} selected · tap in order${selectedIds.length ? `: ${chosenNames.join(" → ")}` : ""}`
                : selectedIds.length === 1
                  ? `Selected: ${chosenNames[0]}`
                  : "Choose one option above."}
            </p>
            <button
              type="button"
              onClick={() => void castVote()}
              disabled={pending || selectedIds.length === 0 || isClosed}
              className="rounded-md bg-accent-hover px-5 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:bg-surface-3 disabled:text-muted-foreground"
            >
              {pending ? "Submitting…" : "Submit final ballot"}
            </button>
          </div>
        </div>
      ) : null}

      {hasVoted ? (
        <div className="sticky bottom-0 border-t border-border bg-background">
          <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-sm text-foreground sm:px-6">
            <CheckIcon />
            <p aria-live="polite">Ballot submitted. Your picks are final and can’t be edited.</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
