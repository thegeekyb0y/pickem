"use client";

import { ClipboardPaste, ImageUp, Loader2, Trash2 } from "lucide-react";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/cn";

type Action = {
  label: string;
  icon: IconComponent;
  onSelect: () => void;
  disabled?: boolean;
};

/**
 * Google-Forms-style overlay for an image: a small dark toolbar in the corner,
 * revealed on hover or keyboard focus. The buttons stay in the tab order, so
 * the control never depends on a pointer.
 */
export default function QuizImageActions({
  onReplace,
  onPaste,
  onDelete,
  busy = false,
  className,
}: {
  onReplace: () => void;
  onPaste: () => void;
  onDelete: () => void;
  busy?: boolean;
  className?: string;
}) {
  const actions: Action[] = [
    { label: "Upload a different image", icon: ImageUp, onSelect: onReplace, disabled: busy },
    { label: "Paste an image from the clipboard", icon: ClipboardPaste, onSelect: onPaste, disabled: busy },
    { label: "Delete this image", icon: Trash2, onSelect: onDelete, disabled: busy },
  ];

  return (
    <div
      className={cn(
        "pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-lg bg-foreground/85 p-1 opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto motion-reduce:transition-none",
        className,
      )}
    >
      {busy ? (
        <span className="grid size-8 place-items-center text-background" aria-hidden="true">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
        </span>
      ) : null}
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            type="button"
            aria-label={action.label}
            title={action.label}
            disabled={action.disabled}
            onClick={action.onSelect}
            className="grid size-8 place-items-center rounded-md text-background transition-colors duration-150 hover:bg-background/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-background disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
          >
            <span aria-hidden="true" className="contents">
              <Icon className="size-4" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
