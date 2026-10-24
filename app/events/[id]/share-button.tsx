"use client";

import { useEffect, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ShareButton({ title, path }: { title: string; path?: string }) {
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
    const url = `${window.location.origin}${path ?? window.location.pathname}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text: `Answer ${title}`, url });
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
      <Button
        type="button"
        variant="tertiary"
        leadingIcon={Share2}
        onClick={() => void handleShare()}
        className="font-fluid min-h-11 px-4"
      >
        Share poll
      </Button>
      <p aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
