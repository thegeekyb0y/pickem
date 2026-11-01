"use client";

import { useSyncExternalStore } from "react";
import { formatPollDateTime } from "@/lib/events/format";

// `useSyncExternalStore` re-renders once after hydration because the client
// snapshot differs from the server snapshot. That is the supported way to
// render a client-only value without a setState-in-effect cascade.
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

type CardTimeProps = {
  prefix: string;
  dateTime: Date;
  fallback: string;
  editedAt: Date | null;
  editedFallback: string | null;
};

/**
 * Cards are rendered on the server, where `Intl` uses the host timezone (UTC on
 * most deployments). Rendering the server string first keeps hydration
 * deterministic, then the post-hydration render replaces it with the viewer's
 * local time.
 */
export default function CardTime({
  prefix,
  dateTime,
  fallback,
  editedAt,
  editedFallback,
}: CardTimeProps) {
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  let label = fallback;
  let editedLabel = editedFallback;
  if (mounted) {
    label = formatPollDateTime(dateTime);
    editedLabel = editedAt ? formatPollDateTime(editedAt) : null;
  }

  return (
    <>
      {prefix}
      <time dateTime={dateTime.toISOString()} suppressHydrationWarning>
        {label}
      </time>
      {editedAt && editedLabel ? (
        <>
          {" · Edited "}
          <time dateTime={editedAt.toISOString()} suppressHydrationWarning>
            {editedLabel}
          </time>
        </>
      ) : null}
    </>
  );
}
