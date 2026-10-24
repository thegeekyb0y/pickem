export const EVENT_SLUG_MIN_LENGTH = 3;
export const EVENT_SLUG_MAX_LENGTH = 48;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Top-level routes the event detail segment can never own. `new` and `drafts`
 * are real routes, and the rest would make a shared link look like product UI.
 */
export const RESERVED_EVENT_SLUGS = new Set([
  "about",
  "admin",
  "api",
  "discover",
  "draft",
  "drafts",
  "events",
  "help",
  "login",
  "logout",
  "new",
  "p",
  "privacy",
  "profile",
  "results",
  "settings",
  "sign-in",
  "signin",
  "signup",
  "support",
  "terms",
  "vote",
]);

export type EventSlugCheck =
  | { ok: true; slug: string }
  | {
      ok: false;
      reason: "invalid" | "reserved" | "uuid";
      message: string;
    };

/**
 * Coerces free text into the URL-safe shape we store. Accents are folded,
 * apostrophes are dropped (so "Ada's poll" reads "adas-poll"), and every run
 * of unsupported characters becomes one hyphen.
 */
export function normalizeEventSlug(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, EVENT_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

export function slugifyEventTitle(title: string): string {
  return normalizeEventSlug(title);
}

/**
 * Keystroke-safe coercion: keeps a trailing hyphen so typing "my-poll" is
 * possible, then `normalizeEventSlug` cleans the edges on blur and save.
 */
export function coerceEventSlugInput(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, EVENT_SLUG_MAX_LENGTH);
}

export function validateEventSlug(raw: string): EventSlugCheck {
  const slug = normalizeEventSlug(raw);

  if (
    slug.length < EVENT_SLUG_MIN_LENGTH ||
    !SLUG_PATTERN.test(slug)
  ) {
    return {
      ok: false,
      reason: "invalid",
      message: `Use ${EVENT_SLUG_MIN_LENGTH}–${EVENT_SLUG_MAX_LENGTH} lowercase letters, numbers, or single hyphens.`,
    };
  }

  if (UUID_PATTERN.test(slug)) {
    return {
      ok: false,
      reason: "uuid",
      message: "That link looks like an event ID. Try another.",
    };
  }

  if (RESERVED_EVENT_SLUGS.has(slug)) {
    return {
      ok: false,
      reason: "reserved",
      message: "That link is reserved. Try another.",
    };
  }

  return { ok: true, slug };
}

/** Canonical public path for an event, preferring its human-readable slug. */
export function eventSharePath(event: { id: string; slug?: string | null }): string {
  return event.slug ? `/events/${event.slug}` : `/events/${event.id}`;
}
