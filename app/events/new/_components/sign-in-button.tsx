"use client";

import { authClient } from "@/lib/auth-client";

export default function SignInButton({
  callbackURL,
  label,
}: {
  callbackURL: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        void authClient.signIn.social({ provider: "google", callbackURL });
      }}
      className="rounded-md bg-accent-hover px-5 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {label}
    </button>
  );
}
