"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import {
  saveEvent,
  uploadOptionImage,
  type OptionInput,
  type Visibility,
} from "@/lib/events/actions";

export type WizardOptionState = {
  key: string;
  label: string;
  description: string;
  showDetails: boolean;
  showImage: boolean;
  imageMode: "upload" | "link";
  imageUrl: string;
  imageBlobKey: string;
  imageAlt: string;
  uploading: boolean;
  imageError: string | null;
  linkDraft: string;
};

export type WizardInitial = {
  eventId: string | null;
  step: 1 | 2 | 3;
  title: string;
  description: string;
  opensAt: string;
  closesAt: string;
  visibility: Visibility;
  options: Omit<
    WizardOptionState,
    "key" | "uploading" | "imageError" | "linkDraft" | "showDetails" | "showImage"
  >[];
};

const STEP_LABELS = ["Details", "Options", "Review"];

function blankOption(): WizardOptionState {
  const key =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `opt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return {
    key,
    label: "",
    description: "",
    showDetails: false,
    showImage: false,
    imageMode: "upload",
    imageUrl: "",
    imageBlobKey: "",
    imageAlt: "",
    uploading: false,
    imageError: null,
    linkDraft: "",
  };
}

function toInput(o: WizardOptionState): OptionInput {
  return {
    label: o.label,
    description: o.description,
    imageSource:
      !o.showImage || o.imageUrl.trim() === ""
        ? "none"
        : o.imageMode === "link"
          ? "external_url"
          : "blob",
    imageUrl: o.imageUrl,
    imageBlobKey: o.imageBlobKey,
    imageAlt: o.imageAlt,
  };
}

function validHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return (
    <AnimatePresence initial={false}>
      {message ? (
        <motion.p
          key={id}
          id={id}
          role="alert"
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          className="mt-1 text-sm text-accent"
        >
          {message}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-foreground placeholder:text-subtle-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const labelClass = "mb-1 block text-sm font-medium text-foreground";

export default function Wizard({ initial }: { initial: WizardInitial }) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const dur = (v: number) => (reduceMotion ? 0 : v);

  const [eventId, setEventId] = useState<string | null>(initial.eventId);
  const [step, setStep] = useState<1 | 2 | 3>(initial.step);
  const [direction, setDirection] = useState(1);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [opensAt, setOpensAt] = useState(initial.opensAt);
  const [closesAt, setClosesAt] = useState(initial.closesAt);
  const [visibility, setVisibility] = useState<Visibility>(initial.visibility);
  const [passcode, setPasscode] = useState("");
  const [options, setOptions] = useState<WizardOptionState[]>(() =>
    initial.options.length > 0
      ? initial.options.map((o) => ({ ...blankOption(), ...o }))
      : [blankOption(), blankOption()],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [confirmRemoveKey, setConfirmRemoveKey] = useState<string | null>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);

  function syncUrl(nextStep: number, id: string | null) {
    const params = new URLSearchParams();
    if (id) params.set("draft", id);
    if (nextStep > 1) params.set("step", String(nextStep));
    const query = params.toString();
    router.replace(query ? `/events/new?${query}` : "/events/new", {
      scroll: false,
    });
  }

  function goStep(next: 1 | 2 | 3) {
    setDirection(next >= step ? 1 : -1);
    setStep(next);
    setFormError(null);
    syncUrl(next, eventId);
  }

  function focusFirst(nextErrors: Record<string, string>) {
    const order = [
      "f-title",
      "f-opensAt",
      "f-closesAt",
      "f-passcode",
      ...options.flatMap((o) => [
        `opt-${o.key}-label`,
        `opt-${o.key}-description`,
        `opt-${o.key}-image`,
      ]),
    ];
    for (const [key] of Object.entries(nextErrors)) {
      const elId =
        key === "options"
          ? `opt-${options[0]?.key ?? "none"}-label`
          : key.startsWith("option-")
            ? null
            : key === "title"
              ? "f-title"
              : key === "opensAt"
                ? "f-opensAt"
                : key === "closesAt"
                  ? "f-closesAt"
                  : key === "passcode"
                    ? "f-passcode"
                    : null;
      const target = elId ?? order.find((id) => id.startsWith("opt-"));
      const el = target ? document.getElementById(target) : null;
      if (el) {
        el.focus();
        return;
      }
    }
    if (formErrorRef.current) formErrorRef.current.focus();
  }

  function validateStep1() {
    const next: Record<string, string> = {};
    if (title.trim().length === 0) next.title = "Give your poll a title.";
    else if (title.trim().length > 160)
      next.title = "Keep titles to 160 characters or fewer.";
    const open = opensAt.trim() === "" ? null : new Date(opensAt);
    const close = closesAt.trim() === "" ? null : new Date(closesAt);
    if (!open || Number.isNaN(open.getTime())) next.opensAt = "Choose when voting opens.";
    if (!close || Number.isNaN(close.getTime()))
      next.closesAt = "Choose when voting closes.";
    if (open && close && close <= open)
      next.closesAt = "Closing time must be after opening time.";
    if (visibility === "passcode" && passcode.length < 4)
      next.passcode = "Set a passcode of at least 4 characters.";
    return next;
  }

  function validateStep2() {
    const next: Record<string, string> = {};
    const kept = options.filter(
      (o) =>
        o.label.trim() !== "" ||
        o.description.trim() !== "" ||
        o.imageUrl.trim() !== "",
    );
    if (kept.length < 2)
      next.options = "Add at least two options before continuing.";
    if (options.length > 8) next.options = "A poll can have at most eight options.";
    options.forEach((o) => {
      if (o.label.trim().length > 120)
        next[`opt-${o.key}-label`] = "Keep labels to 120 characters or fewer.";
      if (o.description.trim().length > 1000)
        next[`opt-${o.key}-description`] =
          "Keep descriptions to 1000 characters or fewer.";
      if (o.showImage && o.imageMode === "link" && o.linkDraft.trim() !== "") {
        if (!validHttpUrl(o.linkDraft))
          next[`opt-${o.key}-image`] = "Paste a valid http(s) image URL.";
      }
    });
    return next;
  }

  function handleNext() {
    const next = step === 1 ? validateStep1() : validateStep2();
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirst(next);
      return;
    }
    goStep(step === 3 ? 3 : ((step + 1) as 1 | 2 | 3));
  }

  async function handleSaveDraft() {
    setSavingDraft(true);
    setFormError(null);
    setSavedNote(null);
    const result = await saveEvent({
      eventId,
      saveAs: "draft",
      draftStep: step,
      title,
      description,
      opensAt,
      closesAt,
      visibility,
      passcode,
      options: options.map(toInput),
    });
    setSavingDraft(false);
    if (result.ok) {
      setEventId(result.eventId);
      syncUrl(step, result.eventId);
      const time = new Intl.DateTimeFormat("en-US", {
        timeStyle: "short",
      }).format(new Date());
      setSavedNote(`Draft saved · ${time}`);
    } else {
      setErrors(result.errors);
      setFormError(result.formError);
      if (result.formError && formErrorRef.current) formErrorRef.current.focus();
      else focusFirst(result.errors);
    }
  }

  async function handlePublish() {
    const stepErrors = { ...validateStep1(), ...validateStep2() };
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) {
      focusFirst(stepErrors);
      return;
    }
    setPublishing(true);
    setFormError(null);
    const result = await saveEvent({
      eventId,
      saveAs: "publish",
      draftStep: 3,
      title,
      description,
      opensAt,
      closesAt,
      visibility,
      passcode,
      options: options.map(toInput),
    });
    setPublishing(false);
    if (result.ok) {
      router.push(`/events/${result.eventId}`);
    } else {
      setErrors(result.errors);
      setFormError(
        result.formError ??
          "Couldn’t publish — fix the highlighted fields and try again.",
      );
      if (formErrorRef.current) formErrorRef.current.focus();
    }
  }

  function updateOption(key: string, patch: Partial<WizardOptionState>) {
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  }

  function addOption() {
    if (options.length >= 8) return;
    setOptions((prev) => [...prev, blankOption()]);
    setErrors((prev) => {
      const next = { ...prev };
      delete next.options;
      return next;
    });
  }

  function removeOption(key: string) {
    const target = options.find((o) => o.key === key);
    if (!target) return;
    const hasContent =
      target.label.trim() !== "" ||
      target.description.trim() !== "" ||
      target.imageUrl.trim() !== "";
    if (hasContent && confirmRemoveKey !== key) {
      setConfirmRemoveKey(key);
      return;
    }
    setConfirmRemoveKey(null);
    setOptions((prev) => {
      const next = prev.filter((o) => o.key !== key);
      return next.length === 0 ? [blankOption()] : next;
    });
  }

  async function handleFile(key: string, file: File | undefined) {
    if (!file) return;
    updateOption(key, { uploading: true, imageError: null });
    const formData = new FormData();
    formData.set("file", file);
    const result = await uploadOptionImage(formData);
    if (result.ok) {
      updateOption(key, {
        uploading: false,
        imageUrl: result.url,
        imageBlobKey: result.key,
        imageMode: "upload",
      });
    } else {
      updateOption(key, { uploading: false, imageError: result.error });
    }
  }

  function attachLink(key: string) {
    const target = options.find((o) => o.key === key);
    if (!target) return;
    if (!validHttpUrl(target.linkDraft)) {
      setErrors((prev) => ({
        ...prev,
        [`opt-${key}-image`]: "Paste a valid http(s) image URL.",
      }));
      document.getElementById(`opt-${key}-image`)?.focus();
      return;
    }
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`opt-${key}-image`];
      return next;
    });
    updateOption(key, {
      imageUrl: target.linkDraft.trim(),
      imageBlobKey: "",
      imageMode: "link",
    });
  }

  const totalLabeled = options.filter((o) => o.label.trim() !== "").length;

  return (
    <div>
      {process.env.NODE_ENV !== "production" ? (
        <div
          data-testid="dev-wizard-switcher"
          className="mb-6 rounded-md border border-border bg-surface-1 p-3"
        >
          <p className="text-xs font-medium uppercase text-subtle-foreground">
            Dev step jumper
          </p>
          <div className="mt-2 flex gap-2">
            {([1, 2, 3] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={step === s}
                onClick={() => goStep(s)}
                className={cn(
                  "rounded-sm border px-3 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  step === s
                    ? "border-accent bg-accent-hover text-accent-foreground"
                    : "border-border text-muted-foreground hover:border-accent hover:text-accent",
                )}
              >
                Step {s}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <ol className="flex items-center gap-2" aria-label="Creation progress">
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          const done = n < step;
          const current = n === step;
          return (
            <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
              {done ? (
                <button
                  type="button"
                  onClick={() => goStep(n)}
                  aria-label={`${label}, completed — go back`}
                  className="grid size-7 place-items-center rounded-full bg-accent text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <AnimatePresence initial={false}>
                    <motion.span
                      key={`check-${n}`}
                      aria-hidden="true"
                      className="text-xs font-bold"
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: dur(0.12), ease: "easeOut" }}
                    >
                      ✓
                    </motion.span>
                  </AnimatePresence>
                </button>
              ) : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-7 place-items-center rounded-full font-mono text-xs font-bold tabular-nums",
                    current
                      ? "border border-accent text-accent"
                      : "border border-border text-subtle-foreground",
                  )}
                >
                  {n}
                </span>
              )}
              <span
                className={cn(
                  "hidden text-sm font-medium sm:block",
                  current ? "text-foreground" : "text-muted-foreground",
                )}
                aria-current={current ? "step" : undefined}
              >
                {label}
              </span>
              {i < STEP_LABELS.length - 1 ? (
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
              ) : null}
            </li>
          );
        })}
      </ol>

      {formError ? (
        <div
          ref={formErrorRef}
          tabIndex={-1}
          role="alert"
          className="mt-5 rounded-md border border-accent bg-surface-1 p-4 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {formError}
        </div>
      ) : null}

      {savedNote ? (
        <p aria-live="polite" className="mt-4 font-mono text-sm tabular-nums text-muted-foreground">
          {savedNote}
        </p>
      ) : null}

      <AnimatePresence mode="wait" custom={direction} initial={false}>
        <motion.section
          key={step}
          custom={direction}
          initial={{ opacity: 0, x: direction === 1 ? 16 : -16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction === 1 ? -12 : 12 }}
          transition={{ duration: dur(0.16), ease: "easeOut" }}
          aria-label={`Step ${step}: ${STEP_LABELS[step - 1]}`}
          className="mt-6 rounded-xl border border-border bg-surface-1 p-5 sm:p-6"
        >
          {step === 1 ? (
            <div className="space-y-5">
              <div>
                <label htmlFor="f-title" className={labelClass}>
                  Title
                </label>
                <input
                  id="f-title"
                  type="text"
                  value={title}
                  maxLength={161}
                  placeholder="Who takes the AFC North?"
                  onChange={(e) => setTitle(e.target.value)}
                  aria-invalid={Boolean(errors.title)}
                  aria-describedby={errors.title ? "f-title-error" : undefined}
                  className={inputClass}
                />
                <FieldError id="f-title-error" message={errors.title} />
              </div>

              <div>
                <label htmlFor="f-description" className={labelClass}>
                  Description <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <textarea
                  id="f-description"
                  value={description}
                  rows={3}
                  placeholder="What are voters deciding, and what should they know?"
                  onChange={(e) => setDescription(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="f-opensAt" className={labelClass}>
                    Voting opens
                  </label>
                  <input
                    id="f-opensAt"
                    type="datetime-local"
                    value={opensAt}
                    onChange={(e) => setOpensAt(e.target.value)}
                    aria-invalid={Boolean(errors.opensAt)}
                    aria-describedby={errors.opensAt ? "f-opensAt-error" : undefined}
                    className={cn(inputClass, "font-mono tabular-nums")}
                  />
                  <FieldError id="f-opensAt-error" message={errors.opensAt} />
                </div>
                <div>
                  <label htmlFor="f-closesAt" className={labelClass}>
                    Voting closes
                  </label>
                  <input
                    id="f-closesAt"
                    type="datetime-local"
                    value={closesAt}
                    onChange={(e) => setClosesAt(e.target.value)}
                    aria-invalid={Boolean(errors.closesAt)}
                    aria-describedby={errors.closesAt ? "f-closesAt-error" : undefined}
                    className={cn(inputClass, "font-mono tabular-nums")}
                  />
                  <FieldError id="f-closesAt-error" message={errors.closesAt} />
                </div>
              </div>

              <div>
                <span id="visibility-label" className={labelClass}>
                  Visibility
                </span>
                <div
                  role="group"
                  aria-labelledby="visibility-label"
                  className="grid grid-cols-3 gap-2"
                >
                  {(
                    [
                      { id: "unlisted", label: "Unlisted", hint: "Link only" },
                      { id: "discoverable", label: "Discover", hint: "Public feed" },
                      { id: "passcode", label: "Passcode", hint: "Code-gated" },
                    ] as const
                  ).map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={visibility === v.id}
                      onClick={() => setVisibility(v.id)}
                      className={cn(
                        "rounded-md border px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                        visibility === v.id
                          ? "border-accent bg-surface-2"
                          : "border-border bg-surface-1 hover:border-accent",
                      )}
                    >
                      <span className="block text-sm font-bold text-foreground">
                        {v.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">{v.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <AnimatePresence initial={false}>
                {visibility === "passcode" ? (
                  <motion.div
                    key="passcode-field"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: dur(0.16), ease: "easeOut" }}
                  >
                    <label htmlFor="f-passcode" className={labelClass}>
                      Shared passcode
                    </label>
                    <input
                      id="f-passcode"
                      type="password"
                      value={passcode}
                      autoComplete="off"
                      placeholder="Share this with your voters"
                      onChange={(e) => setPasscode(e.target.value)}
                      aria-invalid={Boolean(errors.passcode)}
                      aria-describedby={
                        errors.passcode ? "f-passcode-error" : "f-passcode-hint"
                      }
                      className={cn(inputClass, "max-w-xs font-mono")}
                    />
                    <p id="f-passcode-hint" className="mt-1 text-xs text-muted-foreground">
                      Voters enter this once per browser to unlock the poll. It’s stored
                      hashed, never as plaintext.
                    </p>
                    <FieldError id="f-passcode-error" message={errors.passcode} />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          ) : null}

          {step === 2 ? (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-balance text-xl font-bold">Options</h2>
                <p className="font-mono text-sm tabular-nums text-muted-foreground">
                  {totalLabeled} of {options.length} labeled · min 2, max 8
                </p>
              </div>

              {errors.options ? (
                <p role="alert" className="mt-2 text-sm text-accent">
                  {errors.options}
                </p>
              ) : null}

              <ul className="mt-4 space-y-3">
                <AnimatePresence initial={false} mode="popLayout">
                  {options.map((o, index) => (
                    <motion.li
                      key={o.key}
                      layout={false}
                      initial={{ opacity: 0, y: -8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ duration: dur(0.16), ease: "easeOut" }}
                      className="rounded-lg border border-border bg-surface-2 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-mono text-xs tabular-nums text-subtle-foreground">
                          Option {index + 1}
                        </p>
                        <button
                          type="button"
                          onClick={() => removeOption(o.key)}
                          className={cn(
                            "rounded-sm px-2 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                            confirmRemoveKey === o.key
                              ? "bg-accent-hover text-accent-foreground"
                              : "text-muted-foreground hover:text-accent",
                          )}
                        >
                          {confirmRemoveKey === o.key ? "Confirm remove?" : "Remove"}
                        </button>
                      </div>

                      <div className="mt-2">
                        <label htmlFor={`opt-${o.key}-label`} className={labelClass}>
                          Label
                        </label>
                        <input
                          id={`opt-${o.key}-label`}
                          type="text"
                          value={o.label}
                          maxLength={121}
                          placeholder="Team or choice name"
                          onChange={(e) => updateOption(o.key, { label: e.target.value })}
                          aria-invalid={Boolean(errors[`opt-${o.key}-label`])}
                          className={cn(inputClass, "bg-surface-1")}
                        />
                        <FieldError
                          id={`opt-${o.key}-label-error`}
                          message={errors[`opt-${o.key}-label`]}
                        />
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          aria-expanded={o.showDetails}
                          onClick={() =>
                            updateOption(o.key, { showDetails: !o.showDetails })
                          }
                          className="rounded-sm border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        >
                          {o.showDetails ? "Hide description" : "Add description"}
                        </button>
                        <button
                          type="button"
                          aria-expanded={o.showImage}
                          onClick={() => updateOption(o.key, { showImage: !o.showImage })}
                          className="rounded-sm border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        >
                          {o.showImage ? "Hide image" : "Add image"}
                        </button>
                      </div>

                      <AnimatePresence initial={false}>
                        {o.showDetails ? (
                          <motion.div
                            key={`details-${o.key}`}
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: dur(0.16), ease: "easeOut" }}
                            className="mt-3"
                          >
                            <label htmlFor={`opt-${o.key}-description`} className={labelClass}>
                              Description <span className="font-normal text-muted-foreground">(optional)</span>
                            </label>
                            <textarea
                              id={`opt-${o.key}-description`}
                              value={o.description}
                              rows={2}
                              onChange={(e) =>
                                updateOption(o.key, { description: e.target.value })
                              }
                              className={cn(inputClass, "bg-surface-1")}
                            />
                            <FieldError
                              id={`opt-${o.key}-description-error`}
                              message={errors[`opt-${o.key}-description`]}
                            />
                          </motion.div>
                        ) : null}
                      </AnimatePresence>

                      <AnimatePresence initial={false}>
                        {o.showImage ? (
                          <motion.div
                            key={`image-${o.key}`}
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: dur(0.16), ease: "easeOut" }}
                            className="mt-3"
                          >
                            <div
                              role="group"
                              aria-label={`Image source for option ${index + 1}`}
                              className="grid grid-cols-2 gap-2"
                            >
                              {(["upload", "link"] as const).map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  aria-pressed={o.imageMode === m}
                                  onClick={() => updateOption(o.key, { imageMode: m })}
                                  className={cn(
                                    "rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                                    o.imageMode === m
                                      ? "border-accent text-accent"
                                      : "border-border text-muted-foreground hover:border-accent",
                                  )}
                                >
                                  {m === "upload" ? "Upload" : "Paste URL"}
                                </button>
                              ))}
                            </div>

                            {o.imageMode === "upload" ? (
                              <div className="mt-2">
                                <label
                                  htmlFor={`opt-${o.key}-file`}
                                  className="inline-block cursor-pointer rounded-md border border-border bg-surface-1 px-3 py-1.5 text-sm font-medium text-foreground hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                                >
                                  {o.uploading ? "Uploading…" : "Choose image"}
                                </label>
                                <input
                                  id={`opt-${o.key}-file`}
                                  type="file"
                                  accept="image/*"
                                  className="sr-only"
                                  disabled={o.uploading}
                                  onChange={(e) => {
                                    void handleFile(o.key, e.target.files?.[0]);
                                    e.target.value = "";
                                  }}
                                />
                                <span className="ml-2 text-xs text-muted-foreground">
                                  PNG or JPG, under 4 MB.
                                </span>
                              </div>
                            ) : (
                              <div className="mt-2 flex gap-2">
                                <input
                                  id={`opt-${o.key}-image`}
                                  type="url"
                                  inputMode="url"
                                  value={o.linkDraft}
                                  placeholder="https://…"
                                  onChange={(e) =>
                                    updateOption(o.key, { linkDraft: e.target.value })
                                  }
                                  aria-invalid={Boolean(errors[`opt-${o.key}-image`])}
                                  className={cn(inputClass, "bg-surface-1 font-mono")}
                                />
                                <button
                                  type="button"
                                  onClick={() => attachLink(o.key)}
                                  className="shrink-0 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-sm font-medium text-foreground hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                                >
                                  Attach
                                </button>
                              </div>
                            )}

                            {o.imageError ? (
                              <p role="alert" className="mt-1 text-sm text-accent">
                                {o.imageError}
                              </p>
                            ) : null}
                            <FieldError
                              id={`opt-${o.key}-image-error`}
                              message={errors[`opt-${o.key}-image`]}
                            />

                            {o.imageUrl.trim() !== "" ? (
                              <div className="mt-2 flex items-center gap-3">
                                <img
                                  src={o.imageUrl}
                                  alt={o.imageAlt.trim() === "" ? `${o.label.trim() === "" ? "Option" : o.label.trim()} image preview` : o.imageAlt}
                                  width={48}
                                  height={48}
                                  className="size-12 rounded-md border border-border"
                                />
                                <div className="min-w-0 flex-1">
                                  <label htmlFor={`opt-${o.key}-alt`} className={labelClass}>
                                    Alt text <span className="font-normal text-muted-foreground">(optional)</span>
                                  </label>
                                  <input
                                    id={`opt-${o.key}-alt`}
                                    type="text"
                                    value={o.imageAlt}
                                    placeholder="Describe the image"
                                    onChange={(e) =>
                                      updateOption(o.key, { imageAlt: e.target.value })
                                    }
                                    className={cn(inputClass, "bg-surface-1")}
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateOption(o.key, {
                                      imageUrl: "",
                                      imageBlobKey: "",
                                      linkDraft: "",
                                    })
                                  }
                                  className="shrink-0 self-end rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                                >
                                  Remove
                                </button>
                              </div>
                            ) : null}
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>

              <button
                type="button"
                onClick={addOption}
                disabled={options.length >= 8}
                className={cn(
                  "mt-3 w-full rounded-lg border border-dashed px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  options.length >= 8
                    ? "cursor-not-allowed border-border text-subtle-foreground"
                    : "border-border text-muted-foreground hover:border-accent hover:text-accent",
                )}
              >
                {options.length >= 8 ? "Maximum of 8 options reached" : "Add option"}
              </button>
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              <h2 className="text-balance text-xl font-bold">Review</h2>
              <p className="mt-1 text-pretty text-sm leading-5 text-muted-foreground">
                This is exactly what voters will see. Publishing makes the poll live
                on its schedule — drafts stay private until then.
              </p>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="font-medium text-muted-foreground">Title</dt>
                  <dd className="mt-0.5 font-bold text-foreground">
                    {title.trim() === "" ? "Untitled poll" : title.trim()}
                  </dd>
                </div>
                {description.trim() !== "" ? (
                  <div>
                    <dt className="font-medium text-muted-foreground">Description</dt>
                    <dd className="mt-0.5 text-pretty text-foreground">{description.trim()}</dd>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono tabular-nums">
                  <div>
                    <dt className="font-sans font-medium text-muted-foreground">Opens</dt>
                    <dd className="text-foreground">{opensAt === "" ? "—" : opensAt.replace("T", " ")}</dd>
                  </div>
                  <div>
                    <dt className="font-sans font-medium text-muted-foreground">Closes</dt>
                    <dd className="text-foreground">{closesAt === "" ? "—" : closesAt.replace("T", " ")}</dd>
                  </div>
                  <div>
                    <dt className="font-sans font-medium text-muted-foreground">Visibility</dt>
                    <dd className="text-foreground">{visibility}</dd>
                  </div>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">
                    Options ({options.filter((o) => o.label.trim() !== "").length})
                  </dt>
                  <dd className="mt-1 space-y-2">
                    {options
                      .filter((o) => o.label.trim() !== "")
                      .map((o) => (
                        <div
                          key={o.key}
                          className="flex items-center gap-3 rounded-md border border-border bg-surface-2 p-3"
                        >
                          {o.imageUrl.trim() !== "" ? (
                            <img
                              src={o.imageUrl}
                              alt=""
                              width={40}
                              height={40}
                              className="size-10 shrink-0 rounded-md border border-border"
                            />
                          ) : null}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-foreground">
                              {o.label.trim()}
                            </p>
                            {o.description.trim() !== "" ? (
                              <p className="line-clamp-1 text-xs text-muted-foreground">
                                {o.description.trim()}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ))}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}
        </motion.section>
      </AnimatePresence>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => goStep((step - 1) as 1 | 2 | 3)}
              className="rounded-md border border-border bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSaveDraft()}
            disabled={savingDraft || publishing}
            className="rounded-md border border-border bg-surface-1 px-4 py-2 text-sm font-medium text-muted-foreground hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-70"
          >
            {savingDraft ? "Saving…" : "Save as draft"}
          </button>
        </div>
        {step < 3 ? (
          <button
            type="button"
            onClick={handleNext}
            className="rounded-md bg-accent-hover px-5 py-2 text-sm font-medium text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handlePublish()}
            disabled={publishing || savingDraft}
            className="rounded-md bg-accent-hover px-5 py-2 text-sm font-medium text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-70"
          >
            {publishing ? "Publishing…" : eventId ? "Publish draft" : "Publish poll"}
          </button>
        )}
      </div>
    </div>
  );
}
