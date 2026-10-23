"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputField, InputGroup } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import QuizCover from "@/components/quiz-cover";
import { cn } from "@/lib/cn";
import type { QuizCoverKind, QuizCoverMeta } from "@/db/schema/app";
import type { ResultSnapshot } from "@/lib/events/results";
import { useLiveResults } from "@/lib/live/use-live-results";
import { submitVote } from "@/lib/events/voting";
import AnimatedNumber from "./animated-number";
import LiveStatus from "./live-status";
import OwnerControls from "./owner-controls";
import ResultBar from "./result-bar";
import ShareButton from "./share-button";

type QuestionData = {
  id: string;
  prompt: string;
  description: string | null;
  pickType: "single" | "top_n";
  maxPicks: number;
  options: {
    id: string;
    label: string;
    description: string | null;
    imageUrl: string | null;
    imageAlt: string | null;
  }[];
};

type EventData = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  visibility: string;
  opensAt: string;
  closesAt: string;
  coverKind: QuizCoverKind;
  coverRef: string | null;
  coverMeta: QuizCoverMeta | null;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZoneName: "short",
  }).format(new Date(value));
}

function countdownLabel(milliseconds: number) {
  if (milliseconds <= 0) return "Closed";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const format = (value: number) =>
    new Intl.NumberFormat(undefined, { minimumIntegerDigits: 2 }).format(value);
  if (days > 0) return `${days}d ${format(hours)}h ${format(minutes)}m`;
  if (hours > 0) return `${format(hours)}h ${format(minutes)}m ${format(seconds)}s`;
  return `${format(minutes)}m ${format(seconds)}s`;
}

function Countdown({ target, label }: { target: string; label: string }) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    let interval: number | undefined;
    const start = () => {
      if (interval !== undefined) window.clearInterval(interval);
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        interval = window.setInterval(() => setNow(Date.now()), 1000);
      }
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      if (interval !== undefined) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", start);
    };
  }, []);

  if (now === 0) return null;
  return (
    <span className="font-mono tabular-nums" aria-label={`${label} ${countdownLabel(Date.parse(target) - now)}`}>
      {countdownLabel(Date.parse(target) - now)}
    </span>
  );
}

export default function EventDetailClient({
  event,
  questions,
  initialSnapshot,
  initialAnswers,
  isLoggedIn,
  notStarted,
  isClosed,
  isOwner,
}: {
  event: EventData;
  questions: QuestionData[];
  initialSnapshot: ResultSnapshot;
  initialAnswers: Record<string, string[]>;
  isLoggedIn: boolean;
  notStarted: boolean;
  isClosed: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { snapshot, status: liveStatus } = useLiveResults({
    eventId: event.id,
    initial: initialSnapshot,
    enabled: !isClosed && !notStarted,
  });
  const [selectedByQuestion, setSelectedByQuestion] = useState(initialAnswers);
  const [hasVoted, setHasVoted] = useState(Object.values(initialAnswers).some((ids) => ids.length > 0));
  const [guestHandle, setGuestHandle] = useState("");
  const [guestPlatform, setGuestPlatform] = useState<"instagram" | "x">("instagram");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const totalBallots = snapshot.totalBallots;
  const effectiveClosed = isClosed || snapshot.closed;
  const answeredCount = questions.reduce(
    (count, question) => count + ((selectedByQuestion[question.id]?.length ?? 0) > 0 ? 1 : 0),
    0,
  );
  const canVote = !effectiveClosed && !hasVoted && questions.length > 0;
  const allQuestionsAnswered = answeredCount === questions.length;
  const timeTarget = notStarted ? event.opensAt : event.closesAt;
  const timeLabel = notStarted ? "Opens" : "Closes";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function toggleOption(question: QuestionData, optionId: string) {
    if (!canVote || pending) return;
    setError(null);
    setSelectedByQuestion((current) => {
      const selected = current[question.id] ?? [];
      if (selected.includes(optionId)) {
        return { ...current, [question.id]: selected.filter((id) => id !== optionId) };
      }
      if (question.pickType === "single") {
        return { ...current, [question.id]: [optionId] };
      }
      if (selected.length >= question.maxPicks) return current;
      return { ...current, [question.id]: [...selected, optionId] };
    });
  }

  async function castVote() {
    if (!allQuestionsAnswered) {
      setError("Answer every question before submitting your ballot.");
      const unanswered = questions.find((question) => !(selectedByQuestion[question.id]?.length));
      document.getElementById(`question-${unanswered?.id}`)?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
      });
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
      answers: questions.map((question) => ({
        questionId: question.id,
        optionIds: selectedByQuestion[question.id] ?? [],
      })),
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

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-10">
        <LinkBack />

        <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="min-w-0">
            <QuizCover
              kind={event.coverKind}
              coverRef={event.coverRef}
              meta={event.coverMeta}
              layout="banner"
            />
            {event.coverKind === "unsplash" && event.coverMeta?.photographer ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Photo by{" "}
                {event.coverMeta.photographerUrl ? (
                  <a
                    href={event.coverMeta.photographerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {event.coverMeta.photographer}
                  </a>
                ) : (
                  event.coverMeta.photographer
                )}{" "}
                on{" "}
                {event.coverMeta.photoUrl ? (
                  <a
                    href={event.coverMeta.photoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Unsplash
                  </a>
                ) : "Unsplash"}
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Badge
                size="compact"
                variant="dot"
                color={effectiveClosed ? "gray" : notStarted ? "amber" : "green"}
              >
                {effectiveClosed ? (notStarted ? "Scheduled" : "Closed") : notStarted ? "Upcoming" : "Live"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {event.visibility === "discoverable" ? "Discoverable" : event.visibility === "passcode" ? "Passcode protected" : "Unlisted"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-balance text-3xl font-bold leading-10 sm:text-4xl sm:leading-[3rem]">
                {event.title}
              </h1>
              <ShareButton title={event.title} />
            </div>
            {isOwner ? (
              <div className="mt-4">
                <OwnerControls
                  eventId={event.id}
                  isDraft={event.status === "draft"}
                  isLive={!effectiveClosed && !notStarted}
                />
              </div>
            ) : null}
            {event.description ? (
              <p className="mt-3 max-w-2xl text-pretty text-base leading-6 text-muted-foreground">
                {event.description}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm tabular-nums">
              <span className="text-foreground" data-testid="ballot-count">
                <AnimatedNumber value={totalBallots} format="integer" className="tabular-nums" />{" "}
                {totalBallots === 1 ? "ballot" : "ballots"}
              </span>
              <LiveStatus status={liveStatus} />
              <span className="text-subtle-foreground">
                {timeLabel} {formatDate(timeTarget)} ({timezone}) · <Countdown target={timeTarget} label={timeLabel} />
              </span>
            </div>

            <div className="mt-6 space-y-5">
              {questions.length === 0 ? (
                <div className="rounded-xl border border-border bg-surface-1 p-6">
                  <h2 className="text-balance text-xl font-bold">No questions yet</h2>
                  <p className="mt-2 text-pretty text-sm text-muted-foreground">
                    The quiz creator hasn’t added any questions.
                  </p>
                </div>
              ) : (
                questions.map((question, questionIndex) => {
                  const selectedIds = selectedByQuestion[question.id] ?? [];
                  const questionResult = snapshot.questions.find(
                    (result) => result.questionId === question.id,
                  );
                  return (
                    <section
                      id={`question-${question.id}`}
                      key={question.id}
                      aria-labelledby={`question-title-${question.id}`}
                      className="rounded-xl border border-border bg-surface-1 p-4 sm:p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-xs tabular-nums text-subtle-foreground">
                            Question {questionIndex + 1} of {questions.length}
                          </p>
                          <h2 id={`question-title-${question.id}`} className="mt-1 text-balance text-xl font-bold">
                            {question.prompt}
                          </h2>
                          {question.description ? (
                            <p className="mt-1 text-pretty text-sm leading-5 text-muted-foreground">
                              {question.description}
                            </p>
                          ) : null}
                        </div>
                        <Badge size="compact" color="gray">
                          {question.pickType === "single" ? "Pick one" : `Pick top ${question.maxPicks}`}
                        </Badge>
                      </div>

                      <ul className="mt-4 space-y-2" aria-label={`Options for question ${questionIndex + 1}`}>
                        {question.options.map((option) => {
                          const selectionIndex = selectedIds.indexOf(option.id);
                          const selected = selectionIndex >= 0;
                          const count = questionResult?.counts[option.id] ?? 0;
                          const questionTotal = questionResult?.totalBallots ?? 0;
                          const share = questionTotal === 0 ? 0 : count / questionTotal;
                          const selectionLimit = question.pickType === "single" ? 1 : question.maxPicks;
                          const disabled = !canVote || pending || (!selected && selectedIds.length >= selectionLimit);
                          return (
                            <li key={option.id}>
                              <motion.button
                                type="button"
                                aria-pressed={selected}
                                aria-label={question.pickType === "top_n"
                                  ? `${option.label}${selected ? `, rank ${selectionIndex + 1}` : ""}`
                                  : option.label}
                                disabled={disabled}
                                onClick={() => toggleOption(question, option.id)}
                                whileTap={reduceMotion || disabled ? undefined : { scale: 0.99 }}
                                transition={{ duration: reduceMotion ? 0 : 0.12, ease: "easeOut" }}
                                className={cn(
                                  "flex min-h-16 w-full items-center gap-3 rounded-lg border bg-surface-1 p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:p-4",
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
                                {question.pickType === "top_n" ? (
                                  <span aria-hidden="true" className={cn(
                                    "grid size-8 shrink-0 place-items-center rounded-full border font-mono text-sm font-bold tabular-nums",
                                    selected ? "border-accent bg-accent text-accent-foreground" : "border-border text-subtle-foreground",
                                  )}>
                                    {selected ? selectionIndex + 1 : "—"}
                                  </span>
                                ) : selected ? (
                                  <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">✓</span>
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
                                  {snapshot.talliesVisible && questionResult ? (
                                    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-3">
                                      <ResultBar share={Math.min(share, 1)} selected={selected} />
                                    </span>
                                  ) : null}
                                </span>
                                {snapshot.talliesVisible && questionResult ? (
                                  <span className="shrink-0 text-right">
                                    <span className="block font-mono text-lg font-bold tabular-nums text-foreground">
                                      <AnimatedNumber value={share} format="percent" />
                                    </span>
                                    <span className="block font-mono text-xs tabular-nums text-muted-foreground">
                                      <AnimatedNumber value={count} format="integer" /> answers
                                    </span>
                                  </span>
                                ) : null}
                              </motion.button>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="mt-3 text-xs text-muted-foreground">
                        {question.pickType === "single"
                          ? "Choose one answer."
                          : `Choose up to ${question.maxPicks} answers in rank order.`}
                      </p>
                    </section>
                  );
                })
              )}
            </div>

            <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">
              {answeredCount} of {questions.length} questions answered.
            </p>

            {!isLoggedIn && canVote && !hasVoted ? (
              <div className="mt-5 grid gap-3 rounded-xl border border-border bg-surface-1 p-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <InputGroup className="font-fluid w-full">
                  <InputField
                    id="guest-handle"
                    name="guestHandle"
                    autoComplete="nickname"
                    maxLength={40}
                    label="Social handle"
                    placeholder="Your Instagram or X handle"
                    index={0}
                    value={guestHandle}
                    onChange={setGuestHandle}
                    error={error?.startsWith("Enter your Instagram") ? error : undefined}
                  />
                </InputGroup>
                <div>
                  <label htmlFor="guest-platform" className="mb-1 block text-sm font-medium">
                    Platform
                  </label>
                  <Select value={guestPlatform} onValueChange={(value) => setGuestPlatform(value as "instagram" | "x")}>
                    <SelectTrigger id="guest-platform" placeholder="Choose platform" className="font-fluid min-h-11 w-full" />
                    <SelectContent>
                      <SelectItem index={0} value="instagram">Instagram</SelectItem>
                      <SelectItem index={1} value="x">X</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            {error ? (
              <p role="alert" aria-live="polite" className="mt-4 rounded-md border border-border bg-surface-1 p-3 text-sm text-accent">
                {error}
              </p>
            ) : null}
          </section>

          <aside className="lg:pt-0">
            <div className="rounded-xl border border-border bg-surface-1 p-5">
              <h2 className="text-balance text-lg font-bold">Quiz summary</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Ballots</dt>
                  <dd className="font-mono font-bold tabular-nums text-foreground">
                    <AnimatedNumber value={totalBallots} format="integer" />
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Questions</dt>
                  <dd className="font-mono font-bold tabular-nums text-foreground">
                    {new Intl.NumberFormat().format(questions.length)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{timeLabel}</dt>
                  <dd className="text-right font-mono tabular-nums text-foreground">
                    <time dateTime={timeTarget}>{formatDate(timeTarget)}</time>
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Countdown</dt>
                  <dd className="font-mono tabular-nums text-foreground">
                    <Countdown target={timeTarget} label={timeLabel} />
                  </dd>
                </div>
              </dl>
              {questions.some((question) => question.pickType === "top_n") ? (
                <p className="mt-4 border-t border-border pt-3 text-pretty text-xs leading-5 text-muted-foreground">
                  Each question has its own answer format. Top N order is shown on its question.
                </p>
              ) : null}
            </div>
          </aside>
        </div>
      </div>

      {!hasVoted && !effectiveClosed ? (
        <div
          data-testid="vote-submit-bar"
          className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-background sm:bottom-0"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-sm text-muted-foreground">
              {answeredCount} of {questions.length} questions answered
            </p>
            <Button
              type="button"
              variant="primary"
              onClick={() => void castVote()}
              disabled={pending || !allQuestionsAnswered || effectiveClosed}
              className="font-fluid min-h-11 w-full px-5 sm:w-auto"
            >
              {pending ? "Submitting…" : "Submit final ballot"}
            </Button>
          </div>
        </div>
      ) : null}

      {hasVoted ? (
        <div
          data-testid="vote-submitted-bar"
          className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-background sm:bottom-0"
        >
          <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-sm text-foreground sm:px-6">
            <span aria-hidden="true">✓</span>
            <p aria-live="polite">Ballot submitted. Your answers are final and can’t be edited.</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function LinkBack() {
  return (
    <Link
      href="/discover"
      className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      ← Discover quizzes
    </Link>
  );
}
