"use client";

import { useState } from "react";
import { unlockPrivateEvent } from "@/lib/events/voting";

export default function PasscodeGate({ eventId }: { eventId: string }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await unlockPrivateEvent(eventId, passcode);
    setPending(false);
    if (result.ok) {
      window.location.reload();
    } else {
      setError(result.message);
    }
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground">
      <section className="mx-auto w-full max-w-md rounded-xl border border-border bg-surface-1 p-6 sm:p-8">
        <p className="text-xs font-medium uppercase text-muted-foreground">Private poll</p>
        <h1 className="mt-2 text-balance text-2xl font-bold">Enter the passcode</h1>
        <p className="mt-2 text-pretty text-sm leading-5 text-muted-foreground">
          This poll is passcode-protected. Enter the shared code to continue.
        </p>
        <form onSubmit={submit} className="mt-5">
          <label htmlFor="event-passcode" className="mb-1 block text-sm font-medium">
            Passcode
          </label>
          <input
            id="event-passcode"
            type="password"
            autoComplete="off"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "event-passcode-error" : undefined}
            className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
          {error ? (
            <p id="event-passcode-error" role="alert" className="mt-1 text-sm text-accent">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending || passcode.length === 0}
            className="mt-4 w-full rounded-md bg-accent-hover px-4 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-70"
          >
            {pending ? "Checking…" : "Unlock poll"}
          </button>
        </form>
      </section>
    </main>
  );
}
