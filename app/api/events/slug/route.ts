import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { events } from "@/db/schema/app";
import { limitSlugAvailability } from "@/lib/rate-limit";
import { validateEventSlug } from "@/lib/events/slug";

export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user?.id;
  if (!userId) {
    return json({ available: false, reason: "auth", message: "Sign in to check links." }, 401);
  }
  if (!(await limitSlugAvailability(userId))) {
    return json(
      { available: false, reason: "rate-limit", message: "Too many checks. Wait a moment." },
      429,
    );
  }

  const params = new URL(request.url).searchParams;
  const check = validateEventSlug(params.get("slug") ?? "");
  if (!check.ok) {
    return json({ available: false, reason: check.reason, message: check.message });
  }

  const [owner] = await db
    .select({ id: events.id, creatorUserId: events.creatorUserId })
    .from(events)
    .where(eq(events.slug, check.slug))
    .limit(1);

  if (!owner) {
    return json({ available: true, slug: check.slug });
  }

  // Re-saving the draft that already owns this slug is not a conflict.
  if (owner.creatorUserId === userId && owner.id === params.get("eventId")) {
    return json({ available: true, slug: check.slug, current: true });
  }

  return json({ available: false, reason: "taken", message: "That link is already taken." });
}
