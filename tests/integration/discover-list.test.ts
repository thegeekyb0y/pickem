import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyTestDatabaseUrl, assertDatabaseSuitesEnabled, resolveTestDatabaseUrl } from "../helpers/local-env";

const mocks = vi.hoisted(() => ({
  sessionUserId: null as string | null,
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        mocks.sessionUserId ? { user: { id: mocks.sessionUserId } } : null,
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "127.0.0.1",
  limitVoteByIp: async () => true,
  limitVoteByIdentity: async () => true,
  limitPasscodeAttempt: async () => true,
}));

vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidatePath: vi.fn(),
  revalidateTag: mocks.revalidateTag,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "127.0.0.1" }),
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
  }),
}));

const testUrl = resolveTestDatabaseUrl();
const enabled = Boolean(testUrl && process.env.ALLOW_TEST_DB_MUTATION === "1");
assertDatabaseSuitesEnabled("the discover-list suite");
if (enabled && testUrl) {
  applyTestDatabaseUrl(testUrl);
}

type SqlClient = ReturnType<typeof postgres>;

let sql: SqlClient | undefined;
let getDiscoverablePolls: typeof import("@/lib/events/list").getDiscoverablePolls | undefined;
let submitVote: typeof import("@/lib/events/voting").submitVote | undefined;

const ownerId = `pickem-discover-owner-${crypto.randomUUID()}`;
const eventIds: string[] = [];

if (enabled && testUrl) {
  sql = postgres(testUrl, { max: 2, prepare: false });
  ({ getDiscoverablePolls } = await import("@/lib/events/list"));
  ({ submitVote } = await import("@/lib/events/voting"));
}

async function createDiscoverablePoll() {
  if (!sql) throw new Error("Integration database is not enabled");
  const eventId = crypto.randomUUID();
  const questionId = crypto.randomUUID();
  const optionIds = [crypto.randomUUID(), crypto.randomUUID()];
  eventIds.push(eventId);

  await sql`
    insert into "user" (id, name, email, email_verified)
    values (${ownerId}, 'Discover owner', ${`${ownerId}@example.test`}, false)
    on conflict (id) do nothing
  `;
  await sql.begin(async (tx) => {
    await tx`
      insert into events (
        id, creator_user_id, title, status, visibility, opens_at, closes_at
      ) values (
        ${eventId}, ${ownerId}, ${`Discover ${eventId.slice(0, 8)}`}, 'open', 'discoverable',
        clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 hour'
      )
    `;
    await tx`
      insert into questions (id, event_id, prompt, pick_type, max_picks, sort_order)
      values (${questionId}, ${eventId}, 'Pick one', 'single', 1, 0)
    `;
    for (const [index, optionId] of optionIds.entries()) {
      await tx`
        insert into options (id, question_id, label, sort_order)
        values (${optionId}, ${questionId}, ${`Option ${index + 1}`}, ${index})
      `;
    }
  });

  return { eventId, questionId, optionIds };
}

describe.skipIf(!enabled)("getDiscoverablePolls", () => {
  beforeAll(async () => {
    if (!sql) return;
    await sql`select 1`;
  });

  afterEach(async () => {
    if (!sql) return;
    for (const eventId of eventIds.splice(0)) {
      await sql`delete from events where id = ${eventId}`;
    }
    await sql`delete from "user" where id = ${ownerId}`;
    mocks.sessionUserId = null;
    mocks.revalidateTag.mockClear();
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("counts each poll's questions and ballots", async () => {
    if (!getDiscoverablePolls || !submitVote) {
      throw new Error("Integration database is not enabled");
    }
    const poll = await createDiscoverablePoll();

    const before = await getDiscoverablePolls();
    const beforeCard = before.find((item) => item.id === poll.eventId);
    expect(beforeCard).toMatchObject({ questionCount: 1, ballotCount: 0 });

    mocks.sessionUserId = ownerId;
    const ballot = await submitVote({
      eventId: poll.eventId,
      answers: [{ questionId: poll.questionId, optionIds: [poll.optionIds[0]] }],
    });
    expect(ballot).toMatchObject({ ok: true });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("home:polls", { expire: 0 });

    const after = await getDiscoverablePolls();
    const afterCard = after.find((item) => item.id === poll.eventId);
    expect(afterCard).toMatchObject({ questionCount: 1, ballotCount: 1 });
  });
});
