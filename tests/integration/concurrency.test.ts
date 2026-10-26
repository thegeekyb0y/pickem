import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyTestDatabaseUrl, assertDatabaseSuitesEnabled, resolveTestDatabaseUrl } from "../helpers/local-env";

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
vi.mock("@/lib/live/result-cache", () => ({
  invalidateResultCache: vi.fn(async () => undefined),
}));
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

const testUrl = resolveTestDatabaseUrl();
const enabled = Boolean(testUrl && process.env.ALLOW_TEST_DB_MUTATION === "1");
assertDatabaseSuitesEnabled("the concurrency suite");
if (enabled && testUrl) {
  applyTestDatabaseUrl(testUrl);
}

type SqlClient = ReturnType<typeof postgres>;

let sql: SqlClient | undefined;
let submitVote: typeof import("@/lib/events/voting").submitVote | undefined;
let closeEvent: typeof import("@/lib/events/actions").closeEvent | undefined;
let updatePublishedQuiz: typeof import("@/lib/events/actions").updatePublishedQuiz | undefined;
const eventIds: string[] = [];
const userIds: string[] = [];
const creatorUserId = "pickem-concurrency-creator";

if (enabled && testUrl) {
  sql = postgres(testUrl, { max: 4, prepare: false });
  ({ submitVote } = await import("@/lib/events/voting"));
  ({ closeEvent, updatePublishedQuiz } = await import("@/lib/events/actions"));
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
  const questionId = crypto.randomUUID();
  const optionIds = [crypto.randomUUID(), crypto.randomUUID()];
  eventIds.push(eventId);
  userIds.push(creatorUserId);

  await sql`
    insert into "user" (id, name, email, email_verified)
    values (${creatorUserId}, 'Pickem Concurrency', ${`${creatorUserId}@example.test`}, false)
    on conflict (id) do nothing
  `;
  await sql.begin(async (tx) => {
    await tx`
      insert into events (
        id, creator_user_id, title, status, visibility, opens_at, closes_at
      ) values (
        ${eventId}, ${creatorUserId}, 'Concurrency quiz', 'open', 'discoverable',
        clock_timestamp() - interval '1 hour',
        clock_timestamp() + (${closesInMs}::text || ' milliseconds')::interval
      )
    `;
    await tx`
      insert into questions (id, event_id, prompt, pick_type, max_picks, sort_order)
      values (${questionId}, ${eventId}, 'Choose an option', 'single', 1, 0)
    `;
    for (const [index, optionId] of optionIds.entries()) {
      await tx`
        insert into options (id, question_id, label, sort_order)
        values (${optionId}, ${questionId}, ${`Option ${index + 1}`}, ${index})
      `;
    }
  });
  const [row] = await sql`select closes_at from events where id = ${eventId}`;
  return { eventId, questionId, optionIds, closesAt: new Date(row.closes_at) };
}

/**
 * Holds an exclusive lock on one option row. A ballot that selects that option
 * waits for it, after it has already taken its shared lock on the poll row.
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
 * True while the ballot is in flight and the application is waiting on a lock.
 *
 * PostgreSQL keeps row locks in tuple headers rather than pg_locks, so the
 * wait is observed through pg_stat_activity. Only the application's own
 * connections are considered, which the connection name makes unambiguous.
 */
async function hasAppLockWait(ballot: Promise<unknown>): Promise<boolean> {
  if (!sql) return false;
  const settled = await Promise.race([
    ballot.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20)),
  ]);
  if (settled) return false;

  const [row] = await sql`
    select count(*)::int as c
    from pg_stat_activity
    where datname = current_database()
      and wait_event_type = 'Lock'
      and state = 'active'
      and application_name = 'pickem'
  `;
  return Number(row.c) > 0;
}

async function pollStatus(eventId: string) {
  if (!sql) throw new Error("Integration database is not enabled");
  const [row] = await sql`select status from events where id = ${eventId}`;
  return row.status as string;
}

/** Holds the quiz row exclusively, blocking both edits and close-early. */
async function holdEventLock(eventId: string) {
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
    await tx`select id from events where id = ${eventId} for update`;
    acquired();
    await released;
  });

  await locked;
  return { release: () => release(), done: transaction };
}

async function buildEditInput(
  eventId: string,
  overrides: { title?: string; expectedDraftVersion?: number } = {},
) {
  if (!sql) throw new Error("Integration database is not enabled");
  const [row] = await sql`
    select title, draft_version, opens_at, closes_at from events where id = ${eventId}
  `;
  return {
    eventId,
    expectedDraftVersion: overrides.expectedDraftVersion ?? Number(row.draft_version),
    title: overrides.title ?? (row.title as string),
    description: "",
    opensAt: new Date(row.opens_at).toISOString(),
    closesAt: new Date(row.closes_at).toISOString(),
    coverKind: "none" as const,
    coverRef: null,
    coverMeta: null,
  };
}

async function pollTitle(eventId: string) {
  if (!sql) throw new Error("Integration database is not enabled");
  const [row] = await sql`select title, draft_version, edited_at from events where id = ${eventId}`;
  return { title: row.title as string, draftVersion: Number(row.draft_version), editedAt: row.edited_at };
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

      // The first ballot waits on its option row while holding the shared lock
      // on the poll row.
      const held = await holdOptionLock(poll.optionIds[0]);
      const first = submitVote({
        eventId: poll.eventId,
        answers: [{ questionId: poll.questionId, optionIds: [poll.optionIds[0]] }],
        guestHandle: "first",
        guestHandlePlatform: "x",
      });

      try {
        expect(await waitFor(() => hasAppLockWait(first))).toBe(true);

        // The second ballot selects a different option, so the option lock does
        // not block it. It can only commit if ballots do not serialize against
        // each other on the poll row.
        const second = await submitVote({
          eventId: poll.eventId,
          answers: [{ questionId: poll.questionId, optionIds: [poll.optionIds[1]] }],
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
        answers: [{ questionId: poll.questionId, optionIds: [poll.optionIds[0]] }],
        guestHandle: "inflight",
        guestHandlePlatform: "x",
      });
      let closing: Promise<unknown> | undefined;

      try {
        expect(await waitFor(() => hasAppLockWait(ballot))).toBe(true);

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
    "never records a ballot after the closing time",
    async () => {
      if (!sql || !submitVote) return;
      const poll = await createPoll({ closesInMs: 1_500 });

      // Make the ballot as slow as possible so it is likely to still be in
      // flight when the closing time passes. The assertion below does not
      // depend on this: it holds either way.
      const held = await holdOptionLock(poll.optionIds[0]);
      const ballot = submitVote({
        eventId: poll.eventId,
        answers: [{ questionId: poll.questionId, optionIds: [poll.optionIds[0]] }],
        guestHandle: "late",
        guestHandlePlatform: "x",
      });

      const waitMs = poll.closesAt.getTime() - Date.now() + 200;
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      held.release();
      await held.done;

      const result = await ballot;
      if (result.ok) {
        // The ballot landed before the closing time, which is allowed.
        const [row] = await sql`select created_at from votes where id = ${result.voteId}`;
        expect(new Date(row.created_at).getTime()).toBeLessThanOrEqual(poll.closesAt.getTime());
      } else {
        expect(result).toMatchObject({ ok: false, reason: "closed" });
      }

      // The guarantee itself: nothing is recorded with a timestamp after the
      // closing time.
      const [late] = await sql`
        select count(*)::int as c
        from votes
        where event_id = ${poll.eventId} and created_at > ${poll.closesAt}
      `;
      expect(Number(late.c)).toBe(0);
    },
    30_000,
  );

  it(
    "makes an owner edit wait for an in-flight ballot",
    async () => {
      if (!sql || !submitVote || !updatePublishedQuiz) return;
      const poll = await createPoll();

      const held = await holdOptionLock(poll.optionIds[0]);
      const ballot = submitVote({
        eventId: poll.eventId,
        answers: [{ questionId: poll.questionId, optionIds: [poll.optionIds[0]] }],
        guestHandle: "during-edit",
        guestHandlePlatform: "x",
      });
      let editing: Promise<unknown> | undefined;

      try {
        expect(await waitFor(() => hasAppLockWait(ballot))).toBe(true);

        mocks.sessionUserId = creatorUserId;
        editing = updatePublishedQuiz(
          await buildEditInput(poll.eventId, { title: "Edited during ballot" }),
        );

        // FOR UPDATE conflicts with the ballot's FOR KEY SHARE, so the edit
        // cannot land while the ballot is still uncommitted.
        const editSettledEarly = await Promise.race([
          editing.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150)),
        ]);
        expect(editSettledEarly).toBe(false);
      } finally {
        held.release();
        await held.done;
      }

      expect(await ballot).toMatchObject({ ok: true });
      expect(await editing).toMatchObject({ ok: true, edited: true });
      expect(await countBallots(poll.eventId)).toBe(1);
      expect((await pollTitle(poll.eventId)).title).toBe("Edited during ballot");
    },
    30_000,
  );

  it(
    "serializes two simultaneous edits so only one wins the version gate",
    async () => {
      if (!sql || !updatePublishedQuiz) return;
      const poll = await createPoll();
      mocks.sessionUserId = creatorUserId;
      const firstInput = await buildEditInput(poll.eventId, { title: "First editor" });
      const secondInput = { ...firstInput, title: "Second editor" };

      // Queue both edits behind the same row lock so they overlap for certain.
      const held = await holdEventLock(poll.eventId);
      let first: Promise<unknown> | undefined;
      let second: Promise<unknown> | undefined;
      try {
        first = updatePublishedQuiz(firstInput);
        await new Promise((resolve) => setTimeout(resolve, 100));
        second = updatePublishedQuiz(secondInput);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } finally {
        held.release();
        await held.done;
      }

      const [firstResult, secondResult] = (await Promise.all([first, second])) as Array<{
        ok: boolean;
        reason?: string;
      }>;
      expect([firstResult.ok, secondResult.ok].filter(Boolean)).toHaveLength(1);
      expect([firstResult, secondResult].filter((result) => !result.ok)).toHaveLength(1);

      const stored = await pollTitle(poll.eventId);
      expect(stored.title).toBe("First editor");
      expect(stored.draftVersion).toBe(2);
    },
    30_000,
  );

  it(
    "serializes an edit with close-early without losing either",
    async () => {
      if (!sql || !updatePublishedQuiz || !closeEvent) return;
      const poll = await createPoll();
      mocks.sessionUserId = creatorUserId;
      const editInput = await buildEditInput(poll.eventId, { title: "Edited before close" });

      const held = await holdEventLock(poll.eventId);
      let editing: Promise<unknown> | undefined;
      let closing: Promise<unknown> | undefined;
      try {
        editing = updatePublishedQuiz(editInput);
        await new Promise((resolve) => setTimeout(resolve, 100));
        closing = closeEvent(poll.eventId);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } finally {
        held.release();
        await held.done;
      }

      const [editResult, closeResult] = await Promise.all([editing, closing]);
      expect(editResult).toMatchObject({ ok: true });
      expect(closeResult).toEqual({ ok: true });
      expect(await pollStatus(poll.eventId)).toBe("closed");
      const stored = await pollTitle(poll.eventId);
      expect(stored.title).toBe("Edited before close");
      expect(stored.editedAt).not.toBeNull();
    },
    30_000,
  );
});
