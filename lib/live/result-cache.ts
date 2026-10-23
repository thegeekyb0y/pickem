import { randomUUID } from "node:crypto";
import { redis } from "@/lib/redis";
import { getResultSnapshot, type ResultEvent, type ResultSnapshot } from "@/lib/events/results";

const OPEN_TTL_SECONDS = 1;
const CLOSED_TTL_SECONDS = 24 * 60 * 60;
const STALE_TTL_SECONDS = 5;
const LOCK_TTL_MS = 1_000;
const localFlights = new Map<string, Promise<ResultSnapshot>>();

function keys(eventId: string) {
  const root = `pickem:event:${eventId}:results:v2`;
  return { fresh: root, stale: `${root}:stale`, lock: `${root}:lock` };
}

async function readCache(key: string) {
  try {
    return await redis.get<ResultSnapshot>(key);
  } catch {
    return null;
  }
}

function isFinal(event: ResultEvent, snapshot: ResultSnapshot) {
  return (
    event.status === "closed" ||
    event.status === "cancelled" ||
    event.closesAt <= new Date(snapshot.serverNow)
  );
}

async function refill(event: ResultEvent, cacheKeys: ReturnType<typeof keys>) {
  const token = randomUUID();
  let ownsLock = false;
  try {
    ownsLock = (await redis.set(cacheKeys.lock, token, { nx: true, px: LOCK_TTL_MS })) === "OK";
  } catch {
    // Redis is an optimization; a failed lock attempt falls back to the database.
  }

  if (!ownsLock) {
    const stale = await readCache(cacheKeys.stale);
    if (stale) return stale;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const refreshed = await readCache(cacheKeys.fresh);
      if (refreshed) return refreshed;
    }
  }

  const snapshot = await getResultSnapshot(event);
  const ttl = isFinal(event, snapshot) ? CLOSED_TTL_SECONDS : OPEN_TTL_SECONDS;
  try {
    await Promise.all([
      redis.set(cacheKeys.fresh, snapshot, { ex: ttl }),
      redis.set(cacheKeys.stale, snapshot, { ex: isFinal(event, snapshot) ? CLOSED_TTL_SECONDS : STALE_TTL_SECONDS }),
    ]);
  } catch {
    // Continue serving the authoritative database result when Redis is unavailable.
  }
  return snapshot;
}

export function getCachedResultSnapshot(event: ResultEvent): Promise<ResultSnapshot> {
  const cacheKeys = keys(event.id);
  const active = localFlights.get(cacheKeys.fresh);
  if (active) return active;

  const flight = (async () => {
    const cached = await readCache(cacheKeys.fresh);
    if (cached) return cached;
    return refill(event, cacheKeys);
  })();
  localFlights.set(cacheKeys.fresh, flight);
  const clearFlight = () => {
    if (localFlights.get(cacheKeys.fresh) === flight) localFlights.delete(cacheKeys.fresh);
  };
  void flight.then(clearFlight, clearFlight);
  return flight;
}
