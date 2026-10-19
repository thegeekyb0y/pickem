"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { closeEvent, deleteDraft } from "@/lib/events/actions";

type ActionMode = "close" | "delete";

export default function OwnerControls({
  eventId,
  isDraft,
  isLive,
}: {
  eventId: string;
  isDraft: boolean;
  isLive: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<ActionMode | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog(nextMode: ActionMode) {
    setMode(nextMode);
    setError(null);
    dialogRef.current?.showModal();
  }

  async function confirmAction() {
    if (!mode || pending) return;
    setPending(true);
    setError(null);
    const result = mode === "close" ? await closeEvent(eventId) : await deleteDraft(eventId);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }

    dialogRef.current?.close();
    if (mode === "delete") {
      router.push("/events/drafts");
      return;
    }
    router.refresh();
  }

  if (!isDraft && !isLive) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {isLive ? (
          <button
            type="button"
            onClick={() => openDialog("close")}
            className="rounded-md border border-border bg-surface-1 px-3 py-2 text-sm font-medium text-foreground hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Close poll early
          </button>
        ) : null}
        {isDraft ? (
          <button
            type="button"
            onClick={() => openDialog("delete")}
            className="rounded-md border border-border bg-surface-1 px-3 py-2 text-sm font-medium text-foreground hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Delete draft
          </button>
        ) : null}
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="owner-action-title"
        onClose={() => {
          if (!pending) setMode(null);
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border bg-surface-1 p-0 text-foreground shadow-popover backdrop:bg-foreground/30"
      >
        <div className="p-5 sm:p-6">
          <h2 id="owner-action-title" className="text-balance text-xl font-bold">
            {mode === "delete" ? "Delete this draft?" : "Close voting early?"}
          </h2>
          <p className="mt-2 text-pretty text-sm leading-5 text-muted-foreground">
            {mode === "delete"
              ? "This permanently removes the draft and its options."
              : "Voters will no longer be able to submit a ballot. Existing results remain available."}
          </p>
          {error ? (
            <p role="alert" className="mt-3 rounded-md border border-border p-3 text-sm text-accent">
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => dialogRef.current?.close()}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-70"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void confirmAction()}
              className="rounded-md bg-accent-hover px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-70"
            >
              {pending ? "Working…" : mode === "delete" ? "Delete draft" : "Close poll"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
