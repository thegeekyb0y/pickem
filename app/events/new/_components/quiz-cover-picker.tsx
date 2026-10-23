"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InputField, InputGroup } from "@/components/ui/input-group";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import QuizCover from "@/components/quiz-cover";
import { UnsplashCoverImage } from "@/components/unsplash-cover-image";
import { uploadQuizCover, type QuizCoverUploadResult } from "@/lib/events/actions";
import type { QuizCoverKind, QuizCoverMeta } from "@/db/schema/app";
import { getQuizCoverPreset, QUIZ_COVER_PRESETS } from "@/lib/quiz/cover-presets";
import { prepareQuizCover } from "@/lib/quiz/process-cover-image";

type UnsplashPhoto = {
  id: string;
  alt: string;
  color: string | null;
  imageUrl: string;
  previewUrl: string;
  photoUrl: string;
  downloadLocation: string;
  photographer: string;
  photographerUrl: string;
};

type CoverSelection = {
  kind: QuizCoverKind;
  ref: string | null;
  meta: QuizCoverMeta | null;
};

export default function QuizCoverPicker({
  value,
  onChange,
}: {
  value: CoverSelection;
  onChange: (cover: CoverSelection) => void;
}) {
  const [source, setSource] = useState<"preset" | "unsplash" | "upload">(
    value.kind === "none" ? "preset" : value.kind,
  );
  const [query, setQuery] = useState("");
  const [photos, setPhotos] = useState<UnsplashPhoto[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "uploading">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function searchUnsplash(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized.length < 2 || normalized.length > 80) {
      setMessage("Search with 2 to 80 characters.");
      return;
    }
    setStatus("searching");
    setMessage(null);
    try {
      const response = await fetch(`/api/unsplash/search?q=${encodeURIComponent(normalized)}`);
      const data = (await response.json()) as { photos?: UnsplashPhoto[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unsplash search is temporarily unavailable.");
      setPhotos(data.photos ?? []);
      if (!data.photos?.length) setMessage("No photos found. Try a different search.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unsplash search is temporarily unavailable.");
    } finally {
      setStatus("idle");
    }
  }

  async function choosePhoto(photo: UnsplashPhoto) {
    setStatus("searching");
    setMessage(null);
    try {
      const response = await fetch("/api/unsplash/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ downloadLocation: photo.downloadLocation }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not record this photo selection.");
      onChange({
        kind: "unsplash",
        ref: photo.imageUrl,
        meta: {
          photoId: photo.id,
          photographer: photo.photographer,
          photographerUrl: photo.photographerUrl,
          photoUrl: photo.photoUrl,
          downloadLocation: photo.downloadLocation,
          dominantColor: photo.color ?? undefined,
          focalPoint: { x: 0.5, y: 0.5 },
        },
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not record this photo selection.");
    } finally {
      setStatus("idle");
    }
  }

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

  const selectedPreset = value.kind === "preset" ? getQuizCoverPreset(value.ref) : null;

  return (
    <section aria-labelledby="quiz-cover-heading" className="space-y-3">
      <div>
        <h2 id="quiz-cover-heading" className="text-base font-semibold text-foreground">
          Cover image
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A wide banner appears on this poll and its Discover card.
        </p>
      </div>

      <QuizCover
        kind={value.kind}
        coverRef={value.ref}
        meta={value.meta}
        layout="preview"
        showPlaceholder
      />
      {value.kind === "unsplash" && value.meta?.photographer ? (
        <p className="text-xs text-muted-foreground">
          Photo by{" "}
          {value.meta.photographerUrl ? (
            <a
              href={value.meta.photographerUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {value.meta.photographer}
            </a>
          ) : value.meta.photographer}{" "}
          on{" "}
          {value.meta.photoUrl ? (
            <a
              href={value.meta.photoUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Unsplash
            </a>
          ) : "Unsplash"}
        </p>
      ) : null}

      <Tabs
        value={source}
        onValueChange={(next) => {
          if (next === "preset" || next === "unsplash" || next === "upload") setSource(next);
        }}
      >
        <TabsList aria-label="Cover source" className="font-fluid w-full justify-start">
          <TabItem value="preset" label="Presets" />
          <TabItem value="unsplash" label="Unsplash" />
          <TabItem value="upload" label="Upload" />
        </TabsList>

        <TabPanel value="preset" className="pt-4">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Cover presets">
            {QUIZ_COVER_PRESETS.map((preset) => (
              <li key={preset.id}>
                <button
                  type="button"
                  aria-pressed={selectedPreset?.id === preset.id}
                  onClick={() => onChange({ kind: "preset", ref: preset.id, meta: null })}
                  className="group w-full rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span
                    aria-hidden="true"
                    className="block aspect-[2.5/1] rounded-xl border border-border transition-[transform,opacity] duration-160 group-hover:opacity-90 group-active:scale-[0.99]"
                    style={{ background: preset.background }}
                  />
                  <span className="mt-1.5 block text-sm font-medium text-foreground">
                    {preset.label}
                  </span>
                  <span className="block text-xs text-muted-foreground capitalize">
                    {preset.group}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </TabPanel>

        <TabPanel value="unsplash" className="pt-4">
          <form onSubmit={searchUnsplash} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <InputGroup className="font-fluid w-full flex-1">
              <InputField
                index={0}
                label="Search Unsplash"
                value={query}
                onChange={setQuery}
                placeholder="Try a subject or mood"
                disabled={status !== "idle"}
              />
            </InputGroup>
            <Button
              type="submit"
              variant="secondary"
              disabled={status !== "idle"}
              className="font-fluid min-h-11 px-4"
            >
              {status === "searching" ? "Searching…" : "Search"}
            </Button>
          </form>
          {photos.length ? (
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Unsplash search results">
              {photos.map((photo) => (
                <li key={photo.id}>
                  <button
                    type="button"
                    onClick={() => void choosePhoto(photo)}
                    disabled={status !== "idle"}
                    aria-label={`Choose photo by ${photo.photographer}: ${photo.alt}`}
                    className="group w-full overflow-hidden rounded-lg border border-border bg-surface-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span className="relative block aspect-[4/3] bg-surface-2">
                      <UnsplashCoverImage
                        src={photo.previewUrl}
                        sizes="(max-width: 640px) 50vw, 33vw"
                      />
                    </span>
                    <span className="block truncate px-2 py-1.5 text-xs text-muted-foreground">
                      {photo.photographer}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {status === "searching" && !photos.length ? (
            <div aria-hidden="true" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="aspect-[4/3] rounded-lg border border-border bg-surface-2" />
              ))}
            </div>
          ) : null}
        </TabPanel>

        <TabPanel value="upload" className="pt-4">
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
            className="mt-2 block w-full text-sm text-foreground file:mr-3 file:min-h-11 file:rounded-md file:border file:border-border file:bg-surface-1 file:px-3 file:font-medium file:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
          {status === "uploading" ? (
            <p role="status" aria-live="polite" className="mt-2 text-sm text-muted-foreground">
              Processing and uploading cover…
            </p>
          ) : null}
        </TabPanel>
      </Tabs>
      {message ? (
        <p role="status" aria-live="polite" className="text-sm text-accent">
          {message}
        </p>
      ) : null}
    </section>
  );
}
