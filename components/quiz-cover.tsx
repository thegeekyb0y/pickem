import Image from "next/image";
import { cn } from "@/lib/cn";
import type { QuizCoverMeta } from "@/db/schema/app";
import type { QuizCoverKind } from "@/lib/quiz/cover-presets";
import { getQuizCoverPreset } from "@/lib/quiz/cover-presets";
import { UnsplashCoverImage } from "./unsplash-cover-image";

type QuizCoverProps = {
  kind: QuizCoverKind;
  coverRef: string | null;
  meta: QuizCoverMeta | null;
  layout?: "banner" | "card" | "preview";
  showPlaceholder?: boolean;
  className?: string;
};

const layoutClasses = {
  banner: "aspect-[2/1] sm:aspect-[4/1] lg:aspect-[7/1]",
  card: "aspect-[3/1]",
  preview: "aspect-[3/1]",
} as const;

export default function QuizCover({
  kind,
  coverRef,
  meta,
  layout = "banner",
  showPlaceholder = false,
  className,
}: QuizCoverProps) {
  if (kind === "none" || !coverRef) {
    if (!showPlaceholder) return null;
    return (
      <div
        aria-hidden="true"
        className={cn(
          "grid place-items-center overflow-hidden rounded-xl border border-dashed border-border bg-surface-2 text-sm text-muted-foreground",
          layoutClasses[layout],
          className,
        )}
      >
        Choose a cover
      </div>
    );
  }

  const preset = kind === "preset" ? getQuizCoverPreset(coverRef) : null;
  const focalPoint = meta?.focalPoint;

  return (
    <div
      className={cn(
        "relative isolate w-full overflow-hidden rounded-xl border border-border bg-surface-2",
        layoutClasses[layout],
        className,
      )}
    >
      {kind === "unsplash" ? (
        isUnsplashUrl(coverRef) ? (
          <UnsplashCoverImage
            src={coverRef}
            focalPoint={focalPoint}
            sizes={layout === "card" ? "(max-width: 640px) 100vw, 50vw" : "100vw"}
          />
        ) : null
      ) : kind === "upload" ? (
        <Image
          src={coverRef}
          alt=""
          fill
          unoptimized
          sizes={layout === "card" ? "(max-width: 640px) 100vw, 50vw" : "100vw"}
          className="object-cover"
          style={{
            objectPosition: `${(focalPoint?.x ?? 0.5) * 100}% ${(focalPoint?.y ?? 0.5) * 100}%`,
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: preset?.background ?? "var(--surface-2)" }}
        />
      )}
    </div>
  );
}

function isUnsplashUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "images.unsplash.com";
  } catch {
    return false;
  }
}
