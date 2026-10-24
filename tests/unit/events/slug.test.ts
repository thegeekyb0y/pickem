import { describe, expect, it } from "vitest";
import {
  coerceEventSlugInput,
  eventSharePath,
  normalizeEventSlug,
  slugifyEventTitle,
  validateEventSlug,
} from "@/lib/events/slug";

describe("normalizeEventSlug", () => {
  it("folds accents, drops apostrophes, and joins words with one hyphen", () => {
    expect(normalizeEventSlug("  Ada’s Café  Poll!! ")).toBe("adas-cafe-poll");
  });

  it("trims edge hyphens and enforces the maximum length", () => {
    expect(normalizeEventSlug("--hello--world--")).toBe("hello-world");
    expect(normalizeEventSlug("a".repeat(80))).toHaveLength(48);
  });

  it("keeps a trailing hyphen while typing", () => {
    expect(coerceEventSlugInput("My Poll-")).toBe("my-poll-");
    expect(coerceEventSlugInput("My  Poll")).toBe("my-poll");
  });

  it("suggests a readable slug from a title", () => {
    expect(slugifyEventTitle("Friday Night Trivia: Round 2")).toBe(
      "friday-night-trivia-round-2",
    );
  });
});

describe("validateEventSlug", () => {
  it("accepts readable slugs", () => {
    expect(validateEventSlug("friday-trivia")).toEqual({
      ok: true,
      slug: "friday-trivia",
    });
  });

  it("rejects short and malformed slugs", () => {
    expect(validateEventSlug("ab")).toMatchObject({ ok: false, reason: "invalid" });
    expect(validateEventSlug("!!!")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  it("normalizes double hyphens instead of rejecting them", () => {
    expect(validateEventSlug("hello--world")).toEqual({
      ok: true,
      slug: "hello-world",
    });
  });

  it("rejects reserved and UUID-shaped slugs", () => {
    expect(validateEventSlug("new")).toMatchObject({ ok: false, reason: "reserved" });
    expect(
      validateEventSlug("123e4567-e89b-12d3-a456-426614174000"),
    ).toMatchObject({ ok: false, reason: "uuid" });
  });
});

describe("eventSharePath", () => {
  it("prefers the slug and falls back to the id", () => {
    expect(eventSharePath({ id: "abc", slug: "friday-trivia" })).toBe(
      "/events/friday-trivia",
    );
    expect(eventSharePath({ id: "abc", slug: null })).toBe("/events/abc");
  });
});
