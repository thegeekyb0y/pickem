"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InputField, InputGroup } from "@/components/ui/input-group";
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
        <InputGroup className="font-fluid w-full max-w-md">
          <InputField
            id="profile-name"
            name="name"
            autoComplete="name"
            label="Display name"
            maxLength={80}
            required
            index={0}
            value={name}
            onChange={setName}
          />
        </InputGroup>
        <Button
          type="submit"
          variant="primary"
          disabled={isPending || name.trim() === initialName}
          className="font-fluid min-h-11 px-4 disabled:cursor-not-allowed"
        >
          {isPending ? "Saving…" : "Save name"}
        </Button>
      </form>

      <Button
        type="button"
        variant="tertiary"
        onClick={() => void signOut()}
        className="font-fluid min-h-11 px-4"
      >
        Sign out
      </Button>

      <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
