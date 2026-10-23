"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [mode, setMode] = useState<ActionMode | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog(nextMode: ActionMode) {
    setError(null);
    setMode(nextMode);
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

    setMode(null);
    if (mode === "delete") {
      router.push("/events/drafts");
      return;
    }
    router.refresh();
  }

  if (!isDraft && !isLive) return null;

  const dialogOpen = mode !== null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {isLive ? (
          <Button
            type="button"
            variant="tertiary"
            className="font-fluid min-h-11 px-3"
            onClick={() => openDialog("close")}
          >
            Close quiz early
          </Button>
        ) : null}
        {isDraft ? (
          <Button
            type="button"
            variant="tertiary"
            className="font-fluid min-h-11 px-3"
            onClick={() => openDialog("delete")}
          >
            Delete draft
          </Button>
        ) : null}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open && !pending) setMode(null);
        }}
      >
        <DialogContent size="sm" showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>
              {mode === "delete" ? "Delete this draft?" : "Close voting early?"}
            </DialogTitle>
            <DialogDescription>
              {mode === "delete"
                ? "This permanently removes the draft and its questions."
                : "Voters will no longer be able to submit answers. Existing results remain available."}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" aria-live="polite" className="rounded-md border border-border p-3 text-sm text-accent">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  className="font-fluid min-h-11 px-4"
                >
                  Cancel
                </Button>
              }
            />
            <Button
              type="button"
              variant="primary"
              disabled={pending}
              onClick={() => void confirmAction()}
              className="font-fluid min-h-11 px-4"
            >
              {pending ? "Working…" : mode === "delete" ? "Delete draft" : "Close quiz"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
