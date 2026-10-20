import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { applyTestDatabaseUrl } from "../helpers/local-env";

const mocks = vi.hoisted(() => ({
  /** Identity returned to the next server call; null means "guest caller". */
  sessionUserId: null as string | null,
  /** Gives each guest caller a distinct guest session token. */
  guestTokenCounter: 0,
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "127.0.0.1" }),
  cookies: async () => ({
    get: (name: string) =>
      name === "pickem_guest_session"
        ? { name, value: `guest-token-${mocks.guestTokenCounter++}` }
        : undefined,
    set: () => undefined,
  }),
}));

const testUrl = process.env.DATABASE_URL_TEST;
const enabled = Boolean(testUrl && process.env.ALLOW_TEST_DB_MUTATION === "1");
if (enabled && testUrl) {
  applyTestDatabaseUrl(testUrl);
}

type SqlClient = ReturnType<typeof postgres>;

let sql: SqlClient | undefined;
let submitVote: typeof import("@/lib/events/voting").submitVote | undefined;
let closeEvent: typeof import("@/lib/events/actions").closeEvent | undefined;
const eventIds: string[] = [];
const userIds: string[] = [];
const creatorUserId = "pickem-concurrency-creator";

if (enabled && testUrl) {
  sql = postgres(testUrl, { max: 4, prepare: false });
  ({ submitVote } = await import("@/lib/events/voting"));
  ({ closeEvent } = await import("@/lib/events/actions"));
}

async function waitFor(
  predicate: () => Promise<boolean>,
  { timeoutMs = 5_000, intervalMs = 20 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function createPoll({
  closesInMs = 60 * 60 * 1000,
}: { closesInMs?: number } = {}) {
  if (!sql) throw new Error("Integration database is not enabled");
  const eventId = crypto.randomUUID();
  const optionIds = [crypto.randomUUID(), crypto.randomUUID()];
  eventIds.push(eventId);
  userIds.push(creatorUserId);

  await sql`
    insert into "user" (id, name, email, email_verified)
    values (${creatorUserId}, 'Pickem Concurrency', ${`${creatorUserId}@example.test`}, false)
    on conflict (id) do nothing
  `;
  await sql`
    insert into events (
      id, creator_user_id, title, status, visibility, pick_type, max_picks, opens_at, closes_at
    ) values (
      ${eventId}, ${creatorUserId}, 'Concurrency poll', 'open', 'discoverable', 'single', 1,
      clock_timestamp() - interval '1 hour',
      clock_timestamp() + (${closesInMs}::text || ' milliseconds')::interval
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

/**
 * Holds an exclusive lock on one option row. A ballot that selects that option
 * blocks on it, after it has already taken its shared lock on the poll row.
 */
async function holdOptionLock(optionId: string) {
  if (!sql) throw new Error("Integration database is not enabled");
  let release!: () => void;
  let acquired!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const locked = new Promise<void>((resolve) => {
    acquired = resolve;
  });

  const transaction = sql.begin(async (tx) => {
    await tx`select id from options where id = ${optionId} for update`;
    acquired();
    await released;
  });

  await locked;
  return { release: () => release(), done: transaction };
}

async function countBallots(eventId: string) {
  if (!sql) throw new Error("Integration database is not enabled");
  const [row] = await sql`
    select count(*)::int as total from votes where event_id = ${eventId}
  `;
  return Number(row.total);
}

/**
 * True while at least one backend is blocked on a lock. PostgreSQL keeps row
 * locks in tuple headers rather than pg_locks, so the wait is observed through
 * pg_stat_activity instead.
 */
async function hasLockWait(): Promise<boolean> {
  if (!sql) return false;
  const [row] = await sql`
    select count(*)::int as c
    from pg_stat_activity
    where datname = current_database()
      and wait_event_type = 'Lock'
      and state = 'active'
  `;
  return Number(row.c) > 0;
}

async function pollStatus(eventId: string) {
  if (!sql) throw new Error("Integration database is not enabled");
  const [row] = await sql`select status from events where id = ${eventId}`;
  return row.status as string;
}

describe.skipIf(!enabled)("vote and close concurrency", () => {
  beforeAll(async () => {
    if (!sql) return;
    await sql`select 1`;
  });

  afterEach(async () => {
    if (!sql) return;
    for (const eventId of eventIds.splice(0)) {
      await sql`delete from events where id = ${eventId}`;
    }
    for (const userId of userIds.splice(0)) {
      await sql`delete from "user" where id = ${userId}`;
    }
    mocks.sessionUserId = null;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it(
    "lets a second ballot commit while another ballot is still in flight",
    async () => {
      if (!sql || !submitVote) return;
      const poll = await createPoll();

      // The first ballot blocks on its option row while holding the shared
      // lock on the poll row.
      const held = await holdOptionLock(poll.optionIds[0]);
      const first = submitVote({
        eventId: poll.eventId,
        optionIds: [poll.optionIds[0]],
        guestHandle: "first",
        guestHandlePlatform: "x",
      });

      try {
        const firstIsBlocked = await waitFor(hasLockWait);
        expect(firstIsBlocked).toBe(true);

        // The second ballot selects a different option, so the option lock does
        // not block it. It can only commit if ballots do not serialize against
        // each other on the poll row.
        const second = await submitVote({
          eventId: poll.eventId,
          optionIds: [poll.optionIds[1]],
          guestHandle: "second",
          guestHandlePlatform: "x",
        });
        expect(second).toMatchObject({ ok: true });

        const firstSettled = await Promise.race([
          first.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150)),
        ]);
        expect(firstSettled).toBe(false);
      } finally {
        held.release();
        await held.done;
      }

      expect(await first).toMatchObject({ ok: true });
      expect(await countBallots(poll.eventId)).toBe(2);
    },
    30_000,
  );

  it(
    "makes an owner close wait for an in-flight ballot",
    async () => {
      if (!sql || !submitVote || !closeEvent) return;
      const poll = await createPoll();

      const held = await holdOptionLock(poll.optionIds[0]);
      const ballot = submitVote({
        eventId: poll.eventId,
        optionIds: [poll.optionIds[0]],
        guestHandle: "inflight",
        guestHandlePlatform: "x",
      });
      let closing: Promise<unknown> | undefined;

      try {
        const ballotIsBlocked = await waitFor(hasLockWait);
        expect(ballotIsBlocked).toBe(true);

        mocks.sessionUserId = creatorUserId;
        closing = closeEvent(poll.eventId);

        // The close wants an exclusive lock on the poll row, which conflicts
        // with the ballot's shared lock, so it must wait.
        const closeSettledEarly = await Promise.race([
          closing.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150)),
        ]);
        expect(closeSettledEarly).toBe(false);
      } finally {
        held.release();
        await held.done;
      }

      // The ballot commits, and only then does the close proceed.
      expect(await ballot).toMatchObject({ ok: true });
      expect(await closing).toEqual({ ok: true });
      expect(await countBallots(poll.eventId)).toBe(1);
      expect(await pollStatus(poll.eventId)).toBe("closed");
    },
    30_000,
  );

  it(
    "rolls back a ballot that would land after the closing time",
    async () => {
      if (!sql || !submitVote) return;
      const poll = await createPoll({ closesInMs: 400 });

      const held = await holdOptionLock(poll.optionIds[0]);
      const ballot = submitVote({
        eventId: poll.eventId,
        optionIds: [poll.optionIds[0]],
        guestHandle: "late",
        guestHandlePlatform: "x",
      });

      try {
        const ballotIsBlocked = await waitFor(hasLockWait);
        expect(ballotIsBlocked).toBe(true);

        // Let the closing time pass while the ballot is still in flight.
        await new Promise((resolve) => setTimeout(resolve, 900));
      } finally {
        held.release();
        await held.done;
      }

      expect(await ballot).toMatchObject({ ok: false, reason: "closed" });
      expect(await countBallots(poll.eventId)).toBe(0);
    },
    30_000,
  );
});
