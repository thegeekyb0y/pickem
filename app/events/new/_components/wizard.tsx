"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputField, InputGroup } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import QuizCoverPicker from "./quiz-cover-picker";
import QuestionEditor, { blankQuestion, type QuizQuestionState } from "./question-editor";
import { saveQuiz, type SaveQuizInput, type Visibility } from "@/lib/events/actions";
import { parseUtcInstant } from "@/lib/events/date-time";
import { validateQuizQuestions } from "@/lib/events/quiz-validation";
import type { QuizCoverKind, QuizCoverMeta } from "@/db/schema/app";
import { cn } from "@/lib/cn";

const DateTimePicker = dynamic(
  () => import("./date-time-picker").then((module) => module.DateTimePicker),
  {
    ssr: false,
    loading: () => (
      <div aria-hidden="true" className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <div className="h-11 rounded-md border border-border bg-surface-2" />
        <div className="h-11 rounded-md border border-border bg-surface-2" />
      </div>
    ),
  },
);

export type WizardQuestionInitial = {
  prompt: string;
  description: string;
  pickType: "single" | "top_n";
  maxPicks: number;
  options: {
    label: string;
    description: string;
    imageSource: "none" | "blob" | "external_url";
    imageUrl: string;
    imageBlobKey: string;
    imageAlt: string;
  }[];
};

export type WizardInitial = {
  eventId: string | null;
  draftVersion: number;
  hasPasscode: boolean;
  title: string;
  description: string;
  opensAt: string;
  closesAt: string;
  visibility: Visibility;
  coverKind: QuizCoverKind;
  coverRef: string | null;
  coverMeta: QuizCoverMeta | null;
  questions: WizardQuestionInitial[];
};

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toQuestionState(question: WizardQuestionInitial): QuizQuestionState {
  const options = question.options.length
    ? question.options.map((option) => ({
        key: newKey(),
        label: option.label === "Untitled option" ? "" : option.label,
        description: option.description,
        imageSource: option.imageSource,
        imageUrl: option.imageUrl,
        imageBlobKey: option.imageBlobKey,
        imageAlt: option.imageAlt,
        showDetails: option.description !== "",
        showImage: option.imageUrl !== "",
        imageMode: option.imageSource === "external_url" ? "link" as const : "upload" as const,
        uploading: false,
        imageError: null,
        linkDraft: option.imageSource === "external_url" ? option.imageUrl : "",
      }))
    : [blankQuestion().options[0], blankQuestion().options[1]];
  return { ...question, key: newKey(), options };
}

function toSaveQuestions(questions: QuizQuestionState[]) {
  return questions.map((question) => ({
    prompt: question.prompt,
    description: question.description,
    pickType: question.pickType,
    maxPicks: question.maxPicks,
    options: question.options.map((option) => ({
      label: option.label,
      description: option.description,
      imageSource:
        !option.showImage || option.imageUrl.trim() === ""
          ? "none" as const
          : option.imageMode === "link"
            ? "external_url" as const
            : "blob" as const,
      imageUrl: option.showImage ? option.imageUrl : "",
      imageBlobKey: option.showImage ? option.imageBlobKey : "",
      imageAlt: option.showImage ? option.imageAlt : "",
    })),
  }));
}

function formatSavedAt() {
  return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date());
}

export default function Wizard({ initial }: { initial: WizardInitial }) {
  const router = useRouter();
  const [eventId, setEventId] = useState(initial.eventId);
  const [draftVersion, setDraftVersion] = useState(initial.draftVersion);
  const eventIdRef = useRef(initial.eventId);
  const draftVersionRef = useRef(initial.draftVersion);
  const revisionRef = useRef(0);
  const savingRef = useRef(false);
  const queuedSaveRef = useRef(false);
  const blockedAutoSaveRef = useRef(false);
  const publishingRef = useRef(false);

  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [opensAt, setOpensAt] = useState(initial.opensAt);
  const [closesAt, setClosesAt] = useState(initial.closesAt);
  const [visibility, setVisibility] = useState<Visibility>(initial.visibility);
  const [passcode, setPasscode] = useState("");
  const [hasPasscode, setHasPasscode] = useState(initial.hasPasscode);
  const [coverKind, setCoverKind] = useState<QuizCoverKind>(initial.coverKind);
  const [coverRef, setCoverRef] = useState<string | null>(initial.coverRef);
  const [coverMeta, setCoverMeta] = useState<QuizCoverMeta | null>(initial.coverMeta);
  const [questions, setQuestions] = useState<QuizQuestionState[]>(() =>
    initial.questions.length ? initial.questions.map(toQuestionState) : [blankQuestion()],
  );
  const [dirty, setDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saveNote, setSaveNote] = useState("Draft changes save automatically.");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saveFailure, setSaveFailure] = useState(false);
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  const saveDraftRef = useRef<((manual?: boolean) => Promise<void>) | null>(null);

  function markDirty() {
    revisionRef.current += 1;
    setDirty(true);
    setErrors({});
    setSaveNote("Unsaved changes");
  }

  const buildInput = useCallback((
    saveAs: SaveQuizInput["saveAs"],
    expectedVersion: number | null,
  ): SaveQuizInput => {
    return {
      eventId: eventIdRef.current,
      expectedDraftVersion: expectedVersion,
      saveAs,
      draftStep: 1,
      title,
      description,
      opensAt,
      closesAt,
      visibility,
      passcode,
      coverKind,
      coverRef,
      coverMeta,
      questions: toSaveQuestions(questions),
    };
  }, [title, description, opensAt, closesAt, visibility, passcode, coverKind, coverRef, coverMeta, questions]);

  const saveDraft = useCallback(async (manual = false) => {
    if (publishingRef.current || blockedAutoSaveRef.current && !manual) return;
    if (savingRef.current) {
      queuedSaveRef.current = true;
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    const saveRevision = revisionRef.current;
    const createdNewDraft = eventIdRef.current === null;
    try {
      const result = await saveQuiz(buildInput("draft", eventIdRef.current ? draftVersionRef.current : null));
      if (result.ok) {
        eventIdRef.current = result.eventId;
        draftVersionRef.current = result.draftVersion;
        setEventId(result.eventId);
        setDraftVersion(result.draftVersion);
        setHasPasscode(result.hasPasscode);
        if (createdNewDraft) {
          router.replace(`/events/new?draft=${result.eventId}`, { scroll: false });
        }
        if (saveRevision === revisionRef.current) {
          setDirty(false);
          setSaveNote(`Saved at ${formatSavedAt()}`);
        } else {
          queuedSaveRef.current = true;
        }
        setErrors({});
        setFormError(null);
        setSaveFailure(false);
        blockedAutoSaveRef.current = false;
      } else {
        setErrors(result.errors);
        setFormError(
          result.formError ?? "Couldn’t save this draft. Fix the highlighted fields, then save again.",
        );
        setSaveNote("Draft not saved");
        setSaveFailure(Boolean(result.formError));
        blockedAutoSaveRef.current = true;
        queuedSaveRef.current = false;
        if (manual) formErrorRef.current?.focus();
      }
    } catch {
      setSaveNote("Draft save failed");
      setFormError("Couldn’t save this draft. Check your connection and try again.");
      setSaveFailure(true);
      blockedAutoSaveRef.current = true;
      queuedSaveRef.current = false;
      if (manual) formErrorRef.current?.focus();
    } finally {
      savingRef.current = false;
      setIsSaving(false);
      if (queuedSaveRef.current && !publishingRef.current) {
        queuedSaveRef.current = false;
        window.setTimeout(() => void saveDraftRef.current?.(false), 0);
      }
    }
  }, [buildInput, router]);

  useEffect(() => {
    saveDraftRef.current = saveDraft;
  }, [saveDraft]);

  useEffect(() => {
    if (!dirty || publishing || blockedAutoSaveRef.current) return;
    const timeout = window.setTimeout(() => void saveDraftRef.current?.(false), 850);
    return () => window.clearTimeout(timeout);
  }, [dirty, title, description, opensAt, closesAt, visibility, passcode, coverKind, coverRef, coverMeta, questions, publishing]);

  function updateTitle(value: string) {
    markDirty();
    setTitle(value);
  }
  function updateDescription(value: string) {
    markDirty();
    setDescription(value);
  }
  function updateOpensAt(value: string) {
    markDirty();
    setOpensAt(value);
  }
  function updateClosesAt(value: string) {
    markDirty();
    setClosesAt(value);
  }
  function updateVisibility(value: string) {
    if (value !== "unlisted" && value !== "discoverable" && value !== "passcode") return;
    markDirty();
    setVisibility(value);
    if (value !== "passcode") setHasPasscode(false);
  }
  function updatePasscode(value: string) {
    markDirty();
    setPasscode(value);
    if (value.length >= 4) setHasPasscode(true);
  }
  function updateCover(cover: { kind: QuizCoverKind; ref: string | null; meta: QuizCoverMeta | null }) {
    markDirty();
    setCoverKind(cover.kind);
    setCoverRef(cover.ref);
    setCoverMeta(cover.meta);
  }
  function updateQuestions(next: QuizQuestionState[]) {
    markDirty();
    setQuestions(next);
  }

  async function publishQuiz() {
    if (savingRef.current) {
      setFormError("Your latest draft is still saving. Wait a moment, then publish.");
      setSaveFailure(false);
      return;
    }
    const nextErrors: Record<string, string> = {};
    if (!title.trim()) nextErrors.title = "Give your quiz a title.";
    if (title.trim().length > 160) nextErrors.title = "Keep titles to 160 characters or fewer.";
    const opens = parseUtcInstant(opensAt);
    const closes = parseUtcInstant(closesAt);
    if (!opens) nextErrors.opensAt = "Choose when voting opens.";
    if (!closes) nextErrors.closesAt = "Choose when voting closes.";
    if (opens && closes && closes <= opens) nextErrors.closesAt = "Closing time must be after opening time.";
    if (visibility === "passcode" && passcode.length < 4 && !hasPasscode) {
      nextErrors.passcode = "Set a passcode of at least 4 characters.";
    }
    const questionValidation = validateQuizQuestions(toSaveQuestions(questions), true);
    Object.assign(nextErrors, questionValidation.errors);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setFormError("Review the highlighted fields before publishing.");
      setSaveFailure(false);
      formErrorRef.current?.focus();
      return;
    }

    publishingRef.current = true;
    setPublishing(true);
    setFormError(null);
    setSaveFailure(false);
    try {
      const result = await saveQuiz(buildInput("publish", eventIdRef.current ? draftVersionRef.current : null));
      if (result.ok) {
        eventIdRef.current = result.eventId;
        draftVersionRef.current = result.draftVersion;
        setEventId(result.eventId);
        setDraftVersion(result.draftVersion);
        router.push(`/events/${result.eventId}`);
        return;
      }
      setErrors(result.errors);
      setFormError(result.formError ?? "Couldn’t publish. Review the highlighted fields and try again.");
      formErrorRef.current?.focus();
    } catch {
      setFormError("Couldn’t publish. Your edits are still here. Check your connection and try again.");
      formErrorRef.current?.focus();
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Google Forms-style quiz builder</p>
          <h1 className="mt-1 text-balance text-3xl font-bold">
            {eventId ? "Edit quiz draft" : "Create a quiz"}
          </h1>
        </div>
        <Link href="/events/drafts" className="text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          My drafts
        </Link>
      </header>

      <div
        className={cn(
          "flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm",
          formError
            ? "border-accent bg-surface-1 text-accent"
            : "border-border bg-surface-1 text-muted-foreground",
        )}
      >
        <p
          ref={formErrorRef}
          tabIndex={formError ? -1 : undefined}
          role={formError ? "alert" : "status"}
          aria-live="polite"
          className="text-pretty focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {isSaving ? "Saving draft…" : formError ?? saveNote}
        </p>
        {saveFailure ? (
          <Button
            type="button"
            variant="secondary"
            size="compact"
            disabled={isSaving || publishing}
            onClick={() => void saveDraftRef.current?.(true)}
            className="font-fluid min-h-8 px-3"
          >
            Try again
          </Button>
        ) : null}
      </div>

      <section aria-labelledby="quiz-basics-title" className="space-y-5 rounded-xl border border-border bg-surface-1 p-4 sm:p-6">
        <QuizCoverPicker
          value={{ kind: coverKind, ref: coverRef, meta: coverMeta }}
          onChange={updateCover}
        />
        <div className="border-t border-border pt-5">
          <h2 id="quiz-basics-title" className="text-balance text-xl font-bold">Quiz details</h2>
          <div className="mt-4 space-y-4">
            <InputGroup className="font-fluid w-full max-w-none">
              <InputField
                id="f-title"
                name="title"
                label="Quiz title"
                index={0}
                value={title}
                onChange={updateTitle}
                maxLength={160}
                placeholder="What will your group answer?"
                error={errors.title}
              />
            </InputGroup>
            <div>
              <label htmlFor="f-description" className="mb-1 block text-sm font-medium">
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <textarea
                id="f-description"
                value={description}
                rows={2}
                maxLength={2000}
                onChange={(event) => updateDescription(event.target.value)}
                placeholder="Add context for your group"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <DateTimePicker
                  id="f-opensAt"
                  label="Voting opens"
                  kind="opens"
                  value={opensAt}
                  onChange={updateOpensAt}
                  error={errors.opensAt}
                  errorId="f-opensAt-error"
                />
                {errors.opensAt ? <p id="f-opensAt-error" role="alert" className="mt-1 text-sm text-accent">{errors.opensAt}</p> : null}
              </div>
              <div>
                <DateTimePicker
                  id="f-closesAt"
                  label="Voting closes"
                  kind="closes"
                  value={closesAt}
                  referenceInstant={opensAt}
                  onChange={updateClosesAt}
                  error={errors.closesAt}
                  errorId="f-closesAt-error"
                />
                {errors.closesAt ? <p id="f-closesAt-error" role="alert" className="mt-1 text-sm text-accent">{errors.closesAt}</p> : null}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="quiz-visibility" className="mb-1 block text-sm font-medium">Visibility</label>
                <Select value={visibility} onValueChange={updateVisibility}>
                  <SelectTrigger id="quiz-visibility" className="font-fluid min-h-11 w-full" />
                  <SelectContent>
                    <SelectItem index={0} value="unlisted">Unlisted · link only</SelectItem>
                    <SelectItem index={1} value="discoverable">Discover · public feed</SelectItem>
                    <SelectItem index={2} value="passcode">Passcode protected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {visibility === "passcode" ? (
                <InputGroup className="font-fluid w-full max-w-none">
                  <InputField
                    id="f-passcode"
                    name="passcode"
                    type="password"
                    label="Shared passcode"
                    index={0}
                    value={passcode}
                    onChange={updatePasscode}
                    autoComplete="new-password"
                    placeholder={hasPasscode ? "Leave blank to keep the current passcode" : "At least 4 characters"}
                    error={errors.passcode}
                  />
                </InputGroup>
              ) : null}
            </div>
            {visibility === "passcode" ? (
              <p className="-mt-3 text-xs text-muted-foreground">
                Passcodes are stored as a hash and never as plaintext.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="questions-title" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="questions-title" className="text-balance text-2xl font-bold">Questions</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Every question is required. Add 1–20 questions, each with 2–8 options.
            </p>
          </div>
          <Badge size="compact" color="gray">{questions.length} / 20</Badge>
        </div>
        <QuestionEditor
          questions={questions}
          errors={errors}
          onChange={updateQuestions}
        />
      </section>

      <footer className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="tertiary"
          disabled={isSaving || publishing}
          onClick={() => void saveDraftRef.current?.(true)}
          className="font-fluid min-h-11 px-4"
        >
          Save draft
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={isSaving || publishing}
          onClick={() => void publishQuiz()}
          className={cn("font-fluid min-h-11 px-5", publishing && "opacity-70")}
        >
          {publishing ? "Publishing…" : "Publish quiz"}
        </Button>
      </footer>
      <p className="sr-only" aria-live="polite">
        Draft version {draftVersion} {dirty ? "has unsaved changes" : "is saved"}.
      </p>
    </div>
  );
}
