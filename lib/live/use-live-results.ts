"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResultSnapshot } from "@/lib/events/results";
import { pollingTransport } from "./polling-transport";
import type { LiveStatus, ResultsTransport } from "./types";

const SNAPSHOT_BATCH_MS = 250;
const CLIENT_ID_KEY = "pickem:live-client-id";

function getClientId() {
  try {
    const existing = window.sessionStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const random = window.crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const created = `pickem-${random}`;
    window.sessionStorage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch {
    return `pickem-${Date.now()}-${Math.random()}`;
  }
}

function serverClockOffset(snapshot: ResultSnapshot) {
  return Date.parse(snapshot.serverNow) - Date.now();
}

export function useLiveResults({
  eventId,
  initial,
  enabled,
  transport = pollingTransport,
}: {
  eventId: string;
  initial: ResultSnapshot;
  enabled: boolean;
  transport?: ResultsTransport;
}) {
  const [remoteSnapshot, setRemoteSnapshot] = useState<ResultSnapshot | null>(null);
  const [status, setStatus] = useState<LiveStatus>(
    initial.closed ? "closed" : enabled ? "connecting" : "paused",
  );
  const currentRef = useRef(initial);
  const snapshot =
    remoteSnapshot && remoteSnapshot.version >= initial.version ? remoteSnapshot : initial;

  useEffect(() => {
    if (initial.version > currentRef.current.version) currentRef.current = initial;
  }, [initial]);

  const acceptSnapshot = useCallback((next: ResultSnapshot) => {
    if (next.version < currentRef.current.version) return;
    currentRef.current = next;
    setRemoteSnapshot(next);
  }, []);

  useEffect(() => {
    if (!enabled || initial.closed) {
      return;
    }

    let disposed = false;
    let clientId = "";
    let unsubscribe: (() => void) | null = null;
    let flushTimer: number | undefined;
    let closeTimer: number | undefined;
    let pendingSnapshot: ResultSnapshot | null = null;
    let finalFetchDone = false;

    const clearSubscription = () => {
      unsubscribe?.();
      unsubscribe = null;
    };

    const flushPending = () => {
      flushTimer = undefined;
      if (pendingSnapshot) {
        const next = pendingSnapshot;
        pendingSnapshot = null;
        acceptSnapshot(next);
      }
    };

    const queueSnapshot = (next: ResultSnapshot) => {
      if (next.version < Math.max(currentRef.current.version, pendingSnapshot?.version ?? -1)) return;
      pendingSnapshot = next;
      if (flushTimer === undefined) {
        flushTimer = window.setTimeout(flushPending, SNAPSHOT_BATCH_MS);
      }
      if (next.closed) {
        finalFetchDone = true;
        if (closeTimer !== undefined) window.clearTimeout(closeTimer);
        closeTimer = undefined;
        clearSubscription();
        setStatus("closed");
      }
    };

    const runFinalFetch = async () => {
      if (finalFetchDone || disposed) return;
      finalFetchDone = true;
      clearSubscription();
      setStatus("connecting");
      try {
        const finalSnapshot = await transport.fetchSnapshot(eventId, clientId);
        if (!disposed) queueSnapshot(finalSnapshot);
        setStatus("closed");
      } catch {
        if (!disposed) setStatus("closed");
      }
    };

    const scheduleCloseFetch = (next: ResultSnapshot) => {
      if (closeTimer !== undefined) window.clearTimeout(closeTimer);
      if (next.closed) return;
      const remaining = Date.parse(next.closesAt) - (Date.now() + serverClockOffset(next));
      if (remaining <= 0) {
        void runFinalFetch();
      } else {
        closeTimer = window.setTimeout(() => void runFinalFetch(), remaining);
      }
    };

    const connect = () => {
      if (disposed) return;
      if (finalFetchDone) {
        setStatus("closed");
        return;
      }
      if (!navigator.onLine) {
        clearSubscription();
        setStatus("offline");
        return;
      }
      if (document.visibilityState === "hidden") {
        clearSubscription();
        setStatus("paused");
        return;
      }
      clearSubscription();
      setStatus("connecting");
      unsubscribe = transport.subscribe(eventId, clientId, {
        onSnapshot: (next) => {
          queueSnapshot(next);
          scheduleCloseFetch(next);
        },
        onStatus: (next) => setStatus(next),
      });
    };

    const onVisibilityChange = () => connect();
    const onOnline = () => connect();
    const onOffline = () => {
      clearSubscription();
      setStatus("offline");
    };

    clientId = getClientId();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    connect();

    return () => {
      disposed = true;
      clearSubscription();
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      if (closeTimer !== undefined) window.clearTimeout(closeTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [acceptSnapshot, enabled, eventId, initial.closed, transport]);

  return {
    snapshot,
    status: snapshot.closed ? "closed" : enabled ? status : "paused",
  };
}
