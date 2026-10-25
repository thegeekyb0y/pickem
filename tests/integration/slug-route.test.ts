import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  applyTestDatabaseUrl,
  assertDatabaseSuitesEnabled,
  resolveTestDatabaseUrl,
} from "../helpers/local-env";

const mocks = vi.hoisted(() => ({
  userId: null as string | null,
  rateLimitOk: true,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        mocks.userId ? { user: { id: mocks.userId } } : null,
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  limitSlugAvailability: async () => mocks.rateLimitOk,
}));

const testUrl = resolveTestDatabaseUrl();
const enabled = Boolean(testUrl && process.env.ALLOW_TEST_DB_MUTATION === "1");
assertDatabaseSuitesEnabled("the slug route suite");
if (enabled && testUrl) applyTestDatabaseUrl(testUrl);

const sessionUserId = `slug-route-${crypto.randomUUID()}`;
const otherUserId = `slug-route-other-${crypto.randomUUID()}`;
const eventIds: string[] = [];

let sql: ReturnType<typeof postgres> | undefined;
let GET: typeof import("@/app/api/events/slug/route").GET | undefined;

if (enabled && testUrl) {
  sql = postgres(testUrl, { max: 2, prepare: false });
  ({ GET } = await import("@/app/api/events/slug/route"));
}

async function createEvent(creatorUserId: string, slug: string | null) {
  if (!sql) throw new Error("Integration database is not enabled");
  const eventId = crypto.randomUUID();
  eventIds.push(eventId);
  await sql`
    insert into events (
      id, creator_user_id, title, status, visibility, opens_at, closes_at, slug
    ) values (
      ${eventId}, ${creatorUserId}, 'Slug route event', 'draft', 'unlisted',
      clock_timestamp() + interval '1 hour',
      clock_timestamp() + interval '2 hours',
      ${slug}
    )
  `;
  return eventId;
}

async function request(path: string) {
  if (!GET) throw new Error("Integration database is not enabled");
  const response = await GET(new Request(`http://localhost${path}`));
  return { status: response.status, body: await response.json() };
}

describe.skipIf(!enabled)("slug availability route", () => {
  beforeAll(async () => {
    if (!sql) return;
    for (const id of [sessionUserId, otherUserId]) {
      await sql`
        insert into "user" (id, name, email, email_verified)
        values (${id}, 'Slug route user', ${`${id}@example.test`}, false)
      `;
    }
  });

  afterEach(() => {
    mocks.rateLimitOk = true;
    mocks.userId = sessionUserId;
  });

  afterAll(async () => {
    if (!sql) return;
    for (const id of eventIds.splice(0)) await sql`delete from events where id = ${id}`;
    for (const id of [sessionUserId, otherUserId]) {
      await sql`delete from "user" where id = ${id}`;
    }
    await sql.end();
  });

  it("requires a session", async () => {
    mocks.userId = null;
    const result = await request("/api/events/slug?slug=available-slug");
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ available: false, reason: "auth" });
  });

  it("rate limits checks", async () => {
    mocks.rateLimitOk = false;
    const result = await request("/api/events/slug?slug=available-slug");
    expect(result.status).toBe(429);
    expect(result.body).toMatchObject({ available: false, reason: "rate-limit" });
  });

  it("rejects reserved, malformed, and UUID-shaped slugs", async () => {
    const reserved = await request("/api/events/slug?slug=new");
    expect(reserved.body).toMatchObject({ available: false, reason: "reserved" });

    const short = await request("/api/events/slug?slug=ab");
    expect(short.body).toMatchObject({ available: false, reason: "invalid" });

    const uuid = await request(`/api/events/slug?slug=${crypto.randomUUID()}`);
    expect(uuid.body).toMatchObject({ available: false, reason: "uuid" });
  });

  it("normalizes a free-form slug before checking availability", async () => {
    const result = await request("/api/events/slug?slug=Friday-Trivia");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ available: true, slug: "friday-trivia" });
  });

  it("reports other owners' slugs as taken but the current draft as available", async () => {
    const slug = `taken-${crypto.randomUUID().slice(0, 8)}`;
    const eventId = await createEvent(otherUserId, slug);

    const taken = await request(`/api/events/slug?slug=${slug}`);
    expect(taken.body).toMatchObject({ available: false, reason: "taken" });

    mocks.userId = otherUserId;
    const current = await request(`/api/events/slug?slug=${slug}&eventId=${eventId}`);
    expect(current.body).toMatchObject({ available: true, current: true, slug });

    const otherDraft = await request(
      `/api/events/slug?slug=${slug}&eventId=${crypto.randomUUID()}`,
    );
    expect(otherDraft.body).toMatchObject({ available: false, reason: "taken" });
  });
});
