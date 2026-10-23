import { createHash } from "node:crypto";
import { auth } from "@/lib/auth";
import { limitUnsplashApiRequest, limitUnsplashSearch } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";

export const runtime = "nodejs";

type UnsplashPhoto = {
  id: string;
  alt_description: string | null;
  color: string | null;
  urls: { raw: string; small: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
};

type UnsplashSearchResult = {
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

function privateResponse(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function allowedUnsplashUrl(value: unknown, pathPrefix: string) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "api.unsplash.com" || !url.pathname.startsWith(pathPrefix)) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user?.id;
  if (!userId) return privateResponse({ error: "Sign in to search Unsplash." }, 401);

  const query = new URL(request.url).searchParams.get("q")?.trim().replace(/\s+/g, " ") ?? "";
  if (query.length < 2 || query.length > 80) {
    return privateResponse({ error: "Search with 2 to 80 characters." }, 400);
  }
  if (!(await limitUnsplashSearch(userId))) {
    return privateResponse({ error: "Too many image searches. Try again later." }, 429);
  }

  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return privateResponse({ error: "Unsplash search is not configured yet." }, 503);

  const cacheKey = `pickem:unsplash:search:v1:${createHash("sha256").update(query.toLowerCase()).digest("hex")}`;
  try {
    const cached = await redis.get<UnsplashSearchResult[]>(cacheKey);
    if (cached) return privateResponse({ photos: cached, cached: true }, 200);
  } catch {
    // The search still works if the cache is temporarily unavailable.
  }

  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", "18");
  url.searchParams.set("orientation", "landscape");

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
        "Accept-Version": "v1",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      return privateResponse({ error: "Unsplash search is temporarily unavailable." }, 502);
    }

    const data = (await response.json()) as { results?: UnsplashPhoto[] };
    const photos = (data.results ?? []).flatMap((photo): UnsplashSearchResult[] => {
      const imageUrl = photo.urls?.raw;
      const previewUrl = photo.urls?.small;
      const photoUrl = photo.links?.html;
      const downloadLocation = photo.links?.download_location;
      const photographerUrl = photo.user?.links?.html;
      if (
        !photo.id ||
        typeof imageUrl !== "string" || !imageUrl.startsWith("https://images.unsplash.com/") ||
        typeof previewUrl !== "string" || !previewUrl.startsWith("https://images.unsplash.com/") ||
        !allowedUnsplashUrl(photoUrl, "/photos/") ||
        !allowedUnsplashUrl(downloadLocation, "/photos/") ||
        !allowedUnsplashUrl(photographerUrl, "/")
      ) return [];
      const personUrl = new URL(photographerUrl);
      if (!personUrl.pathname.startsWith("/@")) return [];
      return [{
        id: photo.id,
        alt: photo.alt_description?.slice(0, 240) ?? "Unsplash photo",
        color: photo.color,
        imageUrl,
        previewUrl,
        photoUrl,
        downloadLocation,
        photographer: photo.user.name.slice(0, 120),
        photographerUrl,
      }];
    });

    try {
      await redis.set(cacheKey, photos, { ex: 60 * 60 });
  } catch {
    // Cache misses do not make the Unsplash API unavailable.
  }
  if (!(await limitUnsplashApiRequest())) {
    return privateResponse({ error: "Unsplash’s demo search quota is temporarily full." }, 429);
  }
    return privateResponse({ photos, cached: false }, 200);
  } catch {
    return privateResponse({ error: "Unsplash search is temporarily unavailable." }, 502);
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return privateResponse({ error: "Sign in to choose an Unsplash photo." }, 401);
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return privateResponse({ error: "Unsplash search is not configured yet." }, 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateResponse({ error: "Invalid photo selection." }, 400);
  }
  const location = allowedUnsplashUrl(
    body && typeof body === "object" ? (body as { downloadLocation?: unknown }).downloadLocation : null,
    "/photos/",
  );
  if (!location || !location.pathname.endsWith("/download")) {
    return privateResponse({ error: "Invalid Unsplash download location." }, 400);
  }
  if (!(await limitUnsplashApiRequest())) {
    return privateResponse({ error: "Unsplash’s demo quota is temporarily full." }, 429);
  }

  try {
    const response = await fetch(location, {
      method: "GET",
      headers: { Authorization: `Client-ID ${accessKey}`, "Accept-Version": "v1" },
      cache: "no-store",
    });
    if (!response.ok) return privateResponse({ error: "Could not record this photo selection." }, 502);
    return privateResponse({ ok: true }, 200);
  } catch {
    return privateResponse({ error: "Could not record this photo selection." }, 502);
  }
}
