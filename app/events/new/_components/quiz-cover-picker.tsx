"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import QuizCover from "@/components/quiz-cover";
import { uploadQuizCover, type QuizCoverUploadResult } from "@/lib/events/actions";
import type { QuizCoverKind, QuizCoverMeta } from "@/db/schema/app";
import { getQuizCoverPreset, QUIZ_COVER_PRESETS } from "@/lib/quiz/cover-presets";
import { prepareQuizCover } from "@/lib/quiz/process-cover-image";

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

  async function uploadCover(file: File | undefined) {
    if (!file) return;
    setStatus("uploading");
    setMessage(null);
    try {
      const processed = await prepareQuizCover(file);
      const formData = new FormData();
      formData.set("file", processed);
      const result: QuizCoverUploadResult = await uploadQuizCover(formData);
      if (!result.ok) throw new Error(result.error);
      onChange({ kind: "upload", ref: result.url, meta: { focalPoint: { x: 0.5, y: 0.5 } } });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The image could not be uploaded.");
    } finally {
      setStatus("idle");
    }
  }

  function removeCover() {
    setSource("preset");
    setMessage(null);
    onChange({ kind: "none", ref: null, meta: null });
  }

  const selectedPreset = value.kind === "preset" ? getQuizCoverPreset(value.ref) : null;
  const hasImage = value.kind === "upload" || value.kind === "unsplash";
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="quiz-cover-heading" className="text-balance text-base font-semibold text-foreground">
            Cover image
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Optional. A banner appears on this poll and its Discover card.
          </p>
        </div>
        {value.kind !== "none" ? (
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
          <div className="relative">
            <QuizCover
              kind={value.kind}
              coverRef={value.ref}
              meta={value.meta}
              layout="preview"
              showPlaceholder
            />
            {hasImage ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-sm"
                style={{
                  left: `${focalPoint.x * 100}%`,
                  top: `${focalPoint.y * 100}%`,
                }}
              />
            ) : null}
          </div>

          {hasImage ? (
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
                    onClick={() => onChange({ kind: "preset", ref: preset.id, meta: null })}
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
            <label htmlFor="quiz-cover-file" className="block text-sm font-medium text-foreground">
              Upload a banner image
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              PNG, JPEG, or WebP. The image is resized to WebP and metadata is removed.
            </p>
            <input
              id="quiz-cover-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={status === "uploading"}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void uploadCover(file);
              }}
              className="mt-2 block w-full text-sm text-foreground file:mr-3 file:min-h-9 file:rounded-md file:border file:border-border file:bg-surface-1 file:px-3 file:text-xs file:font-medium file:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            {status === "uploading" ? (
              <p role="status" aria-live="polite" className="mt-2 text-sm text-muted-foreground">
                Processing and uploading cover…
              </p>
            ) : null}
          </TabPanel>
        </Tabs>
      </div>

      {message ? (
        <p role="status" aria-live="polite" className="text-sm text-accent">
          {message}
        </p>
      ) : null}
    </section>
  );
}
