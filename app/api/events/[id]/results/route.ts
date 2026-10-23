import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { events } from "@/db/schema/app";
import { hasEventUnlock } from "@/lib/events/access";
import { areTalliesVisible, hideSnapshotTallies } from "@/lib/events/results";
import { resolveResultsAccess } from "@/lib/events/results-access";
import { getCachedResultSnapshot } from "@/lib/live/result-cache";
import { getClientIp, limitResultsRequest } from "@/lib/rate-limit";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function privateResponse(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return privateResponse({ error: "Not found" }, 404);

  try {
    const event = await db.query.events.findFirst({ where: eq(events.id, id) });
    if (!event) return privateResponse({ error: "Not found" }, 404);

    let viewer: { userId?: string | null; passcodeUnlocked?: boolean } = {};
    if (event.status === "draft") {
      const session = await auth.api.getSession({ headers: request.headers });
      viewer = { userId: session?.user?.id ?? null };
    } else if (event.visibility === "passcode" && event.passcodeHash) {
      viewer = { passcodeUnlocked: await hasEventUnlock(event.id, event.passcodeHash) };
    }

    const access = resolveResultsAccess(event, viewer);
    if (access === "not-found") return privateResponse({ error: "Not found" }, 404);
    if (access === "locked") return privateResponse({ error: "Unlock this quiz first" }, 401);

    const ip = getClientIp(request.headers);
    const requestedClientId = request.headers.get("x-client-id")?.trim() ?? "";
    const clientId = /^[a-zA-Z0-9_-]{12,100}$/.test(requestedClientId)
      ? requestedClientId
      : `ip:${ip}`;
    if (!(await limitResultsRequest(ip, clientId, event.id))) {
      return privateResponse({ error: "Too many requests" }, 429);
    }

    const snapshot = await getCachedResultSnapshot(event);
    const visibleSnapshot = areTalliesVisible(event)
      ? snapshot
      : hideSnapshotTallies(snapshot);
    const closedForGood =
      event.status === "closed" ||
      event.status === "cancelled" ||
      event.closesAt <= new Date(snapshot.serverNow);
    const cacheControl =
      access === "public"
        ? closedForGood
          ? "public, s-maxage=86400, stale-while-revalidate=604800"
          : "public, s-maxage=1, stale-while-revalidate=4"
        : "private, no-store";

    return Response.json(visibleSnapshot, {
      headers: { "Cache-Control": cacheControl },
    });
  } catch {
    return privateResponse({ error: "Results are temporarily unavailable" }, 500);
  }
}
