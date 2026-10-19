import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ userId: "pickem-integration-user", cookies: new Map<string, string>() }));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: mocks.userId } }) } },
}));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "127.0.0.1",
  limitVoteByIp: async () => true,
  limitVoteByIdentity: async () => true,
  limitPasscodeAttempt: async () => true,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "127.0.0.1" }),
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.cookies.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => mocks.cookies.set(name, value),
  }),
}));

const testUrl = process.env.DATABASE_URL_TEST;
const enabled = Boolean(testUrl && process.env.ALLOW_TEST_DB_MUTATION === "1");
if (enabled && testUrl) process.env.DATABASE_URL = testUrl;

let sql: ReturnType<typeof postgres> | undefined;
let submitVote: typeof import("@/lib/events/voting").submitVote | undefined;
let getResultSnapshot: typeof import("@/lib/events/results").getResultSnapshot | undefined;
const eventIds: string[] = [];
const userId = mocks.userId;

if (enabled && testUrl) {
  sql = postgres(testUrl, { max: 2, prepare: false });
  ({ submitVote } = await import("@/lib/events/voting"));
  ({ getResultSnapshot } = await import("@/lib/events/results"));
}

async function createPoll({
  pickType = "single",
  maxPicks = 1,
  status = "open",
  visibility = "unlisted",
}: {
  pickType?: "single" | "top_n";
  maxPicks?: number;
  status?: "open" | "closed";
  visibility?: "unlisted" | "passcode";
} = {}) {
  if (!sql) throw new Error("Integration database is not enabled");
  const eventId = crypto.randomUUID();
  const optionIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  eventIds.push(eventId);

  await sql`
    insert into "user" (id, name, email, email_verified)
    values (${userId}, 'Pickem Integration', ${`${userId}@example.test`}, false)
    on conflict (id) do nothing
  `;
  await sql`
    insert into events (
      id, creator_user_id, title, status, visibility, passcode_hash,
      pick_type, max_picks, opens_at, closes_at
    ) values (
      ${eventId}, ${userId}, 'Integration poll', ${status}, ${visibility},
      ${visibility === "passcode" ? "scrypt$testsalt$testhash" : null},
      ${pickType}, ${maxPicks}, clock_timestamp() - interval '1 hour',
      clock_timestamp() + interval '1 hour'
    )
  `;
  for (const [index, optionId] of optionIds.entries()) {
    await sql`
      insert into options (id, event_id, label, sort_order)
      values (${optionId}, ${eventId}, ${`Option ${index + 1}`}, ${index})
    `;
  }
  return { eventId, optionIds };
}

async function countBallots(eventId: string) {
  if (!sql) throw new Error("Integration database is not enabled");
  const [row] = await sql`
    select count(*)::int as total from votes where event_id = ${eventId}
  `;
  return Number(row.total);
}

describe.skipIf(!enabled)("submitVote integration", () => {
  beforeAll(async () => {
    if (!sql) return;
    await sql`select 1`;
  });

  afterEach(async () => {
    if (!sql) return;
    for (const eventId of eventIds.splice(0)) {
      await sql`delete from events where id = ${eventId}`;
    }
    mocks.cookies.clear();
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("rejects invalid single and over-limit top-N ballots before writing", async () => {
    if (!submitVote) return;
    const single = await createPoll();
    const singleResult = await submitVote({ eventId: single.eventId, optionIds: single.optionIds.slice(0, 2) });
    expect(singleResult).toMatchObject({ ok: false, reason: "invalid" });
    expect(await countBallots(single.eventId)).toBe(0);

    const topN = await createPoll({ pickType: "top_n", maxPicks: 2 });
    const topNResult = await submitVote({ eventId: topN.eventId, optionIds: topN.optionIds });
    expect(topNResult).toMatchObject({ ok: false, reason: "invalid" });
    expect(await countBallots(topN.eventId)).toBe(0);
  });

  it("rejects a vote when a concurrent close owns the event lock first", async () => {
    if (!sql || !submitVote) return;
    const poll = await createPoll();
    let releaseClose!: () => void;
    let signalLock!: () => void;
    const holdClose = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const closeLocked = new Promise<void>((resolve) => {
      signalLock = resolve;
    });

    const closeTransaction = sql.begin(async (tx) => {
      await tx`select id from events where id = ${poll.eventId} for update`;
      await tx`
        update events set status = 'closed', closes_at = clock_timestamp()
        where id = ${poll.eventId}
      `;
      signalLock();
      await holdClose;
    });

    await closeLocked;
    const pendingVote = submitVote({ eventId: poll.eventId, optionIds: [poll.optionIds[0]] });
    const isBlockedOnClose = await Promise.race([
      pendingVote.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 100)),
    ]);
    expect(isBlockedOnClose).toBe(true);
    releaseClose();
    await closeTransaction;
    expect(await pendingVote).toMatchObject({ ok: false, reason: "closed" });
    expect(await countBallots(poll.eventId)).toBe(0);
  });

  it("requires an unlock cookie before voting on a passcode poll", async () => {
    if (!submitVote) return;
    const poll = await createPoll({ visibility: "passcode" });
    expect(await submitVote({ eventId: poll.eventId, optionIds: [poll.optionIds[0]] })).toMatchObject({
      ok: false,
      reason: "locked",
    });
  });

  it("keeps snapshot version monotonic by rejecting submitted-ballot deletion", async () => {
    if (!sql || !submitVote || !getResultSnapshot) return;
    const poll = await createPoll();
    const submitted = await submitVote({ eventId: poll.eventId, optionIds: [poll.optionIds[0]] });
    expect(submitted.ok).toBe(true);

    const [row] = await sql`
      select id, status, pick_type, opens_at, closes_at from events where id = ${poll.eventId}
    `;
    const event = {
      id: row.id as string,
      status: row.status as string,
      pickType: row.pick_type as "single" | "top_n",
      opensAt: row.opens_at as Date,
      closesAt: row.closes_at as Date,
    };
    const before = await getResultSnapshot(event);
    expect(before.totalBallots).toBe(1);
    expect(before.version).toBe(1);

    await expect(sql`delete from votes where id = ${submitted.ok ? submitted.voteId : ""}`).rejects.toThrow(
      /Submitted votes cannot be deleted/i,
    );
    const after = await getResultSnapshot(event);
    expect(after.version).toBeGreaterThanOrEqual(before.version);
    expect(after.version).toBe(after.totalBallots);
  });
});
