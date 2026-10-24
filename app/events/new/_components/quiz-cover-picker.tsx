"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import QuizCover from "@/components/quiz-cover";
import QuizImageActions from "@/components/quiz-image-actions";
import { uploadQuizCover, type QuizCoverUploadResult } from "@/lib/events/actions";
import type { QuizCoverKind, QuizCoverMeta } from "@/db/schema/app";
import { getQuizCoverPreset, QUIZ_COVER_PRESETS } from "@/lib/quiz/cover-presets";
import { prepareQuizCover } from "@/lib/quiz/process-cover-image";
import {
  imageFileFromClipboard,
  imageFileFromDataTransfer,
} from "@/lib/quiz/clipboard-image";

type CoverSource = "preset" | "upload";

type CoverSelection = {
  kind: QuizCoverKind;
  ref: string | null;
  meta: QuizCoverMeta | null;
};

const percentFormat = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

export default function QuizCoverPicker({
  value,
  onChange,
}: {
  value: CoverSelection;
  onChange: (cover: CoverSelection) => void;
}) {
  const [source, setSource] = useState<CoverSource>(
    value.kind === "upload" || value.kind === "unsplash" ? "upload" : "preset",
  );
  const [status, setStatus] = useState<"idle" | "uploading">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [undoCover, setUndoCover] = useState<CoverSelection | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const undoTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    },
    [],
  );

  function clearUndo() {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    setUndoCover(null);
  }

  function openFilePicker() {
    setMessage(null);
    fileInputRef.current?.click();
  }

  async function uploadCover(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Choose an image file (PNG, JPEG, or WebP).");
      return;
    }
    clearUndo();
    setStatus("uploading");
    setMessage(null);
    try {
      const processed = await prepareQuizCover(file);
      const formData = new FormData();
      formData.set("file", processed);
      const result: QuizCoverUploadResult = await uploadQuizCover(formData);
      if (!result.ok) throw new Error(result.error);
      onChange({ kind: "upload", ref: result.url, meta: { focalPoint: { x: 0.5, y: 0.5 } } });
      setSource("upload");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The image could not be uploaded.");
    } finally {
      setStatus("idle");
    }
  }

  function removeCover() {
    if (value.kind === "none" && !value.ref) return;
    setUndoCover(value);
    setMessage("Cover removed.");
    onChange({ kind: "none", ref: null, meta: null });
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => {
      setUndoCover(null);
      undoTimerRef.current = null;
    }, 8000);
  }

  function undoRemove() {
    if (!undoCover) return;
    onChange(undoCover);
    clearUndo();
    setMessage(null);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const file = imageFileFromDataTransfer(event.clipboardData);
    if (!file) {
      setMessage("The clipboard doesn’t contain an image. Copy an image, then paste again.");
      return;
    }
    event.preventDefault();
    void uploadCover(file);
  }

  async function pasteFromClipboard() {
    setMessage(null);
    try {
      const file = await imageFileFromClipboard();
      if (!file) {
        setMessage("No image on the clipboard. Copy an image or press Ctrl/⌘ + V.");
        previewRef.current?.focus();
        return;
      }
      await uploadCover(file);
    } catch {
      setMessage("Clipboard access was blocked. Press Ctrl/⌘ + V on the preview instead.");
      previewRef.current?.focus();
    }
  }

  const selectedPreset = value.kind === "preset" ? getQuizCoverPreset(value.ref) : null;
  const hasCover = value.kind !== "none" && Boolean(value.ref);
  const hasCrop = value.kind === "upload" || value.kind === "unsplash";
  const focalPoint = {
    x: clamp(value.meta?.focalPoint?.x ?? 0.5),
    y: clamp(value.meta?.focalPoint?.y ?? 0.5),
  };

  function updateFocalPoint(axis: "x" | "y", percent: number) {
    onChange({
      ...value,
      meta: {
        ...(value.meta ?? {}),
        focalPoint: {
          ...focalPoint,
          [axis]: clamp(percent / 100),
        },
      },
    });
  }

  return (
    <section aria-labelledby="quiz-cover-heading" className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Cover image file"
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void uploadCover(file);
        }}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="quiz-cover-heading" className="text-balance text-base font-semibold text-foreground">
            Cover image
          </h2>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            Optional. A banner appears on this poll and its Discover card.
          </p>
        </div>
        {hasCover ? (
          <Button
            type="button"
            variant="ghost"
            size="compact"
            onClick={removeCover}
            className="font-fluid min-h-9 px-3"
          >
            Remove cover
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div
            ref={previewRef}
            tabIndex={hasCover ? 0 : undefined}
            role="group"
            aria-label={
              hasCover
                ? "Cover image preview. Press Control or Command plus V to paste an image."
                : undefined
            }
            onPaste={handlePaste}
            className="group relative rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {hasCover ? (
              <>
                <QuizCover
                  kind={value.kind}
                  coverRef={value.ref}
                  meta={value.meta}
                  layout="preview"
                />
                <QuizImageActions
                  onReplace={openFilePicker}
                  onPaste={() => void pasteFromClipboard()}
                  onDelete={removeCover}
                  busy={status === "uploading"}
                />
                {hasCrop ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-sm"
                    style={{
                      left: `${focalPoint.x * 100}%`,
                      top: `${focalPoint.y * 100}%`,
                    }}
                  />
                ) : null}
              </>
            ) : (
              <button
                type="button"
                onClick={openFilePicker}
                disabled={status === "uploading"}
                className="flex aspect-[3/1] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-surface-2 px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:border-accent hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none"
              >
                <ImagePlus aria-hidden="true" className="size-5" />
                <span>Add cover image</span>
                <span className="text-xs font-normal">Click, or paste an image</span>
              </button>
            )}

            {status === "uploading" ? (
              <div
                aria-hidden="true"
                className="absolute inset-0 grid place-items-center rounded-xl bg-foreground/60"
              >
                <span className="inline-flex items-center gap-2 rounded-md bg-background px-2.5 py-1.5 text-xs font-medium text-foreground">
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                  Uploading…
                </span>
              </div>
            ) : null}
          </div>

          {hasCrop ? (
            <fieldset className="mt-3 min-w-0 space-y-2">
              <legend className="text-xs font-medium text-foreground">Focal point</legend>
              <p className="text-pretty text-xs text-muted-foreground">
                Choose the part to keep visible when the image is cropped.
              </p>
              <label className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs text-muted-foreground">
                <span>Horizontal</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(focalPoint.x * 100)}
                  onChange={(event) => updateFocalPoint("x", Number(event.target.value))}
                  className="h-1.5 w-full min-w-0 cursor-pointer accent-[var(--accent)]"
                />
                <span className="text-right font-mono tabular-nums text-foreground">
                  {percentFormat.format(focalPoint.x)}
                </span>
              </label>
              <label className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs text-muted-foreground">
                <span>Vertical</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(focalPoint.y * 100)}
                  onChange={(event) => updateFocalPoint("y", Number(event.target.value))}
                  className="h-1.5 w-full min-w-0 cursor-pointer accent-[var(--accent)]"
                />
                <span className="text-right font-mono tabular-nums text-foreground">
                  {percentFormat.format(focalPoint.y)}
                </span>
              </label>
            </fieldset>
          ) : null}

          {value.kind === "unsplash" ? (
            <p className="mt-3 text-pretty text-xs text-muted-foreground">
              This poll uses a legacy Unsplash cover. Choose a preset or upload an image to
              replace it.
            </p>
          ) : null}
        </div>

        <Tabs
          value={source}
          onValueChange={(next) => {
            if (next === "preset" || next === "upload") setSource(next);
          }}
          size="compact"
        >
          <TabsList aria-label="Cover source" className="font-fluid w-full">
            <TabItem value="preset" label="Presets" />
            <TabItem value="upload" label="Upload" />
          </TabsList>

          <TabPanel value="preset" className="pt-3">
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Cover presets">
              {QUIZ_COVER_PRESETS.map((preset) => (
                <li key={preset.id}>
                  <button
                    type="button"
                    aria-pressed={selectedPreset?.id === preset.id}
                    onClick={() => {
                      clearUndo();
                      setMessage(null);
                      onChange({ kind: "preset", ref: preset.id, meta: null });
                    }}
                    className="w-full rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span
                      aria-hidden="true"
                      className="block aspect-[3/1] rounded-lg border border-border"
                      style={{ background: preset.background }}
                    />
                    <span className="mt-1 block text-xs font-medium text-foreground">
                      {preset.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </TabPanel>

          <TabPanel value="upload" className="pt-3">
            <div className="rounded-lg border border-dashed border-border bg-surface-1 p-3">
              <p className="text-sm font-medium text-foreground">Upload a banner image</p>
              <p className="mt-1 text-xs text-muted-foreground">
                PNG, JPEG, or WebP. The image is resized to WebP and metadata is removed.
              </p>
              <Button
                type="button"
                variant="secondary"
                leadingIcon={Upload}
                disabled={status === "uploading"}
                onClick={openFilePicker}
                className="font-fluid mt-3 min-h-9 px-3"
              >
                Choose image
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Or focus the preview and paste an image with Ctrl/⌘ + V.
              </p>
            </div>
          </TabPanel>
        </Tabs>
      </div>

      <div
        aria-live="polite"
        className="flex min-h-5 flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        {message ? <span>{message}</span> : null}
        {undoCover ? (
          <button
            type="button"
            onClick={undoRemove}
            className="font-medium text-foreground underline underline-offset-2 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Undo
          </button>
        ) : null}
      </div>
    </section>
  );
}
