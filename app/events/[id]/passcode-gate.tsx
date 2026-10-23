"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InputField, InputGroup } from "@/components/ui/input-group";
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
        <p className="text-xs font-medium text-muted-foreground">Private poll</p>
        <h1 className="mt-2 text-balance text-2xl font-bold">Enter the passcode</h1>
        <p className="mt-2 text-pretty text-sm leading-5 text-muted-foreground">
          This poll is passcode-protected. Enter the shared code to continue.
        </p>
        <form onSubmit={submit} className="mt-5">
          <InputGroup className="font-fluid w-full">
            <InputField
              id="event-passcode"
              name="passcode"
              type="password"
              autoComplete="off"
              label="Passcode"
              index={0}
              value={passcode}
              onChange={setPasscode}
              error={error ?? undefined}
            />
          </InputGroup>
          <Button
            type="submit"
            variant="primary"
            disabled={pending || passcode.length === 0}
            className="font-fluid mt-4 min-h-11 w-full"
          >
            {pending ? "Checking…" : "Unlock poll"}
          </Button>
        </form>
      </section>
    </main>
  );
}
