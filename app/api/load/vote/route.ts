import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { GUEST_COOKIE } from "@/lib/events/access";
import { submitVote } from "@/lib/events/voting";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function notFound() {
  return Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview" || process.env.ENABLE_LOAD_TEST_ROUTES !== "1") {
    return notFound();
  }

  const expected = process.env.LOAD_TEST_SECRET;
  const provided = request.headers.get("x-load-test-secret") ?? "";
  if (!expected) return notFound();
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length) return notFound();
  if (!timingSafeEqual(expectedBytes, providedBytes)) return notFound();

  const guestToken = (await cookies()).get(GUEST_COOKIE)?.value;
  if (!guestToken) {
    return Response.json({ error: "A synthetic guest cookie is required" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("eventId" in body) ||
    typeof body.eventId !== "string" ||
    !UUID_PATTERN.test(body.eventId) ||
    !("optionIds" in body) ||
    !Array.isArray(body.optionIds) ||
    body.optionIds.length < 1 ||
    body.optionIds.length > 8 ||
    body.optionIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))
  ) {
    return Response.json({ error: "Invalid ballot payload" }, { status: 400 });
  }

  const result = await submitVote({
    eventId: body.eventId,
    optionIds: body.optionIds,
    guestHandle: "load-test",
    guestHandlePlatform: "x",
  });
  if (result.ok) {
    return Response.json({ ok: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  }
  const status = result.reason === "rate-limited" ? 429 : result.reason === "closed" ? 409 : 400;
  return Response.json({ ok: false, reason: result.reason }, { status, headers: { "Cache-Control": "no-store" } });
}
