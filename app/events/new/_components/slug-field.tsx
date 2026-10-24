"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { InputField, InputGroup } from "@/components/ui/input-group";
import {
  coerceEventSlugInput,
  normalizeEventSlug,
  validateEventSlug,
} from "@/lib/events/slug";

type Availability =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; current?: boolean }
  | { status: "unavailable"; message: string };

type RemoteAvailability = {
  slug: string;
  available: boolean;
  message?: string;
};

export default function EventSlugField({
  value,
  initialValue,
  eventId,
  title,
  error,
  onChange,
}: {
  value: string;
  initialValue: string;
  eventId: string | null;
  title: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const [remote, setRemote] = useState<RemoteAvailability | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();

    const normalized = normalizeEventSlug(value);
    if (value.trim() === "" || normalized === initialValue) return;
    const local = validateEventSlug(value);
    if (!local.ok) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ slug: local.slug });
        if (eventId) params.set("eventId", eventId);
        const response = await fetch(`/api/events/slug?${params}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          available?: boolean;
          reason?: string;
          message?: string;
        };
        if (!response.ok && response.status !== 429) {
          setRemote({
            slug: normalized,
            available: false,
            message: "Couldn’t check that link right now. Try again in a moment.",
          });
          return;
        }
        setRemote({
          slug: normalized,
          available: data.available === true,
          message:
            data.available === true
              ? undefined
              : data.reason === "rate-limit"
                ? "Couldn’t check that link right now. Try again in a moment."
                : data.message ?? "That link is not available.",
        });
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setRemote({
          slug: normalized,
          available: false,
          message: "Couldn’t check that link right now. Try again in a moment.",
        });
      }
    }, 450);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [eventId, initialValue, value]);

  const normalized = normalizeEventSlug(value);
  const localCheck = value.trim() === "" ? null : validateEventSlug(value);
  const availability: Availability = !localCheck
    ? { status: "idle" }
    : normalized === initialValue
      ? { status: "available", current: true }
      : !localCheck.ok
        ? { status: "unavailable", message: localCheck.message }
        : remote?.slug === normalized
          ? remote.available
            ? { status: "available" }
            : { status: "unavailable", message: remote.message ?? "That link is not available." }
          : { status: "checking" };

  const suggestion = normalizeEventSlug(title);
  const canSuggest = value.trim() === "" && suggestion.length >= 3;
  const message = error
    ? error
    : availability.status === "checking"
      ? "Checking availability…"
      : availability.status === "available"
        ? availability.current
          ? "This is your current share link."
          : "Link is available."
        : availability.status === "unavailable"
          ? availability.message
          : "Lowercase letters, numbers, and hyphens. Leave blank to share the ID link.";

  return (
    <div className="space-y-1.5">
      <InputGroup className="font-fluid w-full max-w-none">
        <InputField
          id="f-slug"
          name="slug"
          label="Custom share link"
          index={0}
          value={value}
          onChange={(next) => onChange(coerceEventSlugInput(next))}
          onBlur={() => {
            const normalized = normalizeEventSlug(value);
            if (normalized !== value) onChange(normalized);
          }}
          maxLength={48}
          placeholder="friday-trivia"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby="f-slug-status"
          leading={
            <span aria-hidden="true" className="text-xs text-muted-foreground">
              /events/
            </span>
          }
          error={error}
        />
      </InputGroup>
      <p
        id="f-slug-status"
        aria-live="polite"
        className={
          error || availability.status === "unavailable"
            ? "text-xs text-accent"
            : "text-xs text-muted-foreground"
        }
      >
        {availability.status === "checking" ? (
          <Loader2
            aria-hidden="true"
            className="mr-1 inline size-3 animate-spin motion-reduce:animate-none"
          />
        ) : null}
        {availability.status === "available" && !availability.current ? (
          <Check aria-hidden="true" className="mr-1 inline size-3" />
        ) : null}
        {message}
      </p>
      {canSuggest ? (
        <button
          type="button"
          onClick={() => onChange(suggestion)}
          className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Use the poll title
        </button>
      ) : null}
    </div>
  );
}
