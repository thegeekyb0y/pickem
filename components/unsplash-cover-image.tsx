"use client";

import Image, { type ImageLoaderProps } from "next/image";

export function unsplashCoverLoader({ src, width, quality }: ImageLoaderProps) {
  const url = new URL(src);
  if (url.protocol !== "https:" || url.hostname !== "images.unsplash.com") {
    throw new Error("Quiz cover images must use Unsplash's image CDN");
  }
  url.searchParams.set("auto", "format");
  url.searchParams.set("fit", "crop");
  url.searchParams.set("w", String(width));
  url.searchParams.set("q", String(quality ?? 80));
  return url.toString();
}

export function UnsplashCoverImage({
  src,
  focalPoint,
  sizes,
}: {
  src: string;
  focalPoint?: { x: number; y: number };
  sizes: string;
}) {
  const x = Math.max(0, Math.min(1, focalPoint?.x ?? 0.5));
  const y = Math.max(0, Math.min(1, focalPoint?.y ?? 0.5));

  return (
    <Image
      src={src}
      loader={unsplashCoverLoader}
      alt=""
      fill
      sizes={sizes}
      quality={80}
      className="object-cover"
      style={{ objectPosition: `${x * 100}% ${y * 100}%` }}
    />
  );
}
