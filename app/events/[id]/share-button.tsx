"use client";

import { useEffect, useRef, useState } from "react";

export default function ShareButton({ title }: { title: string }) {
  const [message, setMessage] = useState("");
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  function announce(text: string) {
    setMessage(text);
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setMessage(""), 2200);
  }

  async function handleShare() {
    const url = `${window.location.origin}${window.location.pathname}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text: `Vote on ${title}`, url });
        announce("Poll shared.");
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        announce("Link copied.");
        return;
      }

      const field = document.createElement("textarea");
      field.value = url;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      announce(copied ? "Link copied." : "Copy the poll URL from your address bar.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      announce("Could not share this poll. Copy the URL from your address bar.");
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button
        type="button"
        onClick={() => void handleShare()}
        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <svg
          aria-hidden="true"
          className="size-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Share poll
      </button>
      <p aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
