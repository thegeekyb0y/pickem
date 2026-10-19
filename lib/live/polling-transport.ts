import type { ResultSnapshot } from "@/lib/events/results";
import type { LiveStatus, ResultsTransport } from "./types";

const POLL_INTERVAL_MS = 2_000;
const MAX_BACKOFF_MS = 15_000;

class SnapshotRequestError extends Error {
  constructor(readonly status: number) {
    super(`Results request failed with status ${status}`);
  }
}

async function fetchSnapshot(
  eventId: string,
  clientId: string,
  signal?: AbortSignal,
): Promise<ResultSnapshot> {
  const response = await fetch(`/api/events/${eventId}/results`, {
    method: "GET",
    cache: "no-store",
    headers: { "x-client-id": clientId },
    signal,
  });
  if (!response.ok) throw new SnapshotRequestError(response.status);
  return (await response.json()) as ResultSnapshot;
}

function withJitter(milliseconds: number) {
  return Math.round(milliseconds * (0.8 + Math.random() * 0.4));
}

function retryDelay(failures: number) {
  return withJitter(Math.min(1_000 * 2 ** Math.max(0, failures - 1), MAX_BACKOFF_MS));
}

export const pollingTransport: ResultsTransport = {
  fetchSnapshot,

  subscribe(eventId, clientId, handlers) {
    let stopped = false;
    let failures = 0;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    let liveStatus: LiveStatus = "connecting";

    const setStatus = (next: LiveStatus) => {
      if (liveStatus === next) return;
      liveStatus = next;
      handlers.onStatus(next);
    };

    const schedule = (delay: number) => {
      if (!stopped) timer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (stopped) return;
      controller = new AbortController();
      try {
        const snapshot = await fetchSnapshot(eventId, clientId, controller.signal);
        failures = 0;
        setStatus(snapshot.closed ? "closed" : "live");
        handlers.onSnapshot(snapshot);
        if (!snapshot.closed) schedule(withJitter(POLL_INTERVAL_MS));
      } catch (error) {
        if (stopped || (error instanceof DOMException && error.name === "AbortError")) return;
        failures += 1;
        if (error instanceof SnapshotRequestError && [401, 404].includes(error.status)) {
          setStatus("unavailable");
          return;
        }
        setStatus("reconnecting");
        schedule(retryDelay(failures));
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  },
};
