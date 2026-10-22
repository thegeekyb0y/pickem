"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { updateProfileName } from "@/lib/events/actions";

export default function ProfileSettingsForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    startTransition(async () => {
      const result = await updateProfileName(name);
      setMessage(result.ok ? "Display name saved." : result.message);
      if (result.ok) {
        setName(result.name);
        router.refresh();
      }
    });
  }

  async function signOut() {
    setMessage("");
    try {
      await authClient.signOut();
      router.push("/discover");
      router.refresh();
    } catch {
      setMessage("Couldn’t sign out. Try again.");
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={saveName} className="space-y-3">
        <div>
          <label htmlFor="profile-name" className="mb-1 block text-sm font-medium">
            Display name
          </label>
          <input
            id="profile-name"
            name="name"
            autoComplete="name"
            maxLength={80}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
        </div>
        <button
          type="submit"
          disabled={isPending || name.trim() === initialName}
          className="min-h-11 rounded-md bg-accent-hover px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Saving…" : "Save name"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => void signOut()}
        className="min-h-11 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Sign out
      </button>

      <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
