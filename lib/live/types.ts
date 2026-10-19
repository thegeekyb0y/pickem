import type { ResultSnapshot } from "@/lib/events/results";

export type LiveStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "paused"
  | "offline"
  | "closed"
  | "unavailable";

export type SnapshotHandler = (snapshot: ResultSnapshot) => void;

export interface ResultsTransport {
  subscribe(
    eventId: string,
    clientId: string,
    handlers: {
      onSnapshot: SnapshotHandler;
      onStatus: (status: LiveStatus) => void;
    },
  ): () => void;
  fetchSnapshot(eventId: string, clientId: string, signal?: AbortSignal): Promise<ResultSnapshot>;
}
