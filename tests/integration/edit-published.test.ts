import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyTestDatabaseUrl, assertDatabaseSuitesEnabled, resolveTestDatabaseUrl } from "../helpers/local-env";

const mocks = vi.hoisted(() => ({
  sessionUserId: null as string | null,
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
  limitQuizCoverUpload: async () => true,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
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
vi.mock("@/lib/live/result-cache", () => ({
  invalidateResultCache: vi.fn(async () => undefined),
}));

const testUrl = resolveTestDatabaseUrl();
const enabled = Boolean(testUrl && process.env.ALLOW_TEST_DB_MUTATION === "1");
assertDatabaseSuitesEnabled("the edit-published suite");
if (enabled && testUrl) {
  applyTestDatabaseUrl(testUrl);
}

type SqlClient = ReturnType<typeof postgres>;

let sql: SqlClient | undefined;
let updatePublishedQuiz: typeof import("@/lib/events/actions").updatePublishedQuiz | undefined;
let closeEvent: typeof import("@/lib/events/actions").closeEvent | undefined;
let submitVote: typeof import("@/lib/events/voting").submitVote | undefined;
let getEventPhase: typeof import("@/lib/events/list").getEventPhase | undefined;

const ownerId = `pickem-edit-owner-${crypto.randomUUID()}`;
const otherId = `pickem-edit-other-${crypto.randomUUID()}`;
const eventIds: string[] = [];

if (enabled && testUrl) {
  sql = postgres(testUrl, { max: 4, prepare: false });
  ({ updatePublishedQuiz, closeEvent } = await import("@/lib/events/actions"));
  ({ submitVote } = await import("@/lib/events/voting"));
  ({ getEventPhase } = await import("@/lib/events/list"));
}

async function createUser(id: string) {
  if (!sql) return;
  await sql`
    insert into "user" (id, name, email, email_verified)
    values (${id}, 'Edit owner', ${`${id}@example.test`}, false)
    on conflict (id) do nothing
  `;
}

type Fixture = {
  eventId: string;
  questionId: string;
  optionIds: string[];
  opensAt: Date;
  closesAt: Date;
  draftVersion: number;
};

async function createPoll({
  status = "open",
  opensOffsetSeconds = -3_600,
  closesOffsetSeconds = 3_600,
  title = "Editable poll",
}: {
  status?: "scheduled" | "open" | "closed";
  opensOffsetSeconds?: number;
  closesOffsetSeconds?: number;
  title?: string;
} = {}): Promise<Fixture> {
  if (!sql) throw new Error("Integration database is not enabled");
  const eventId = crypto.randomUUID();
  const questionId = crypto.randomUUID();
  const optionIds = [crypto.randomUUID(), crypto.randomUUID()];
  eventIds.push(eventId);

  await sql.begin(async (tx) => {
    await tx`
      insert into events (
        id, creator_user_id, title, description, status, visibility, draft_version,
        opens_at, closes_at
      ) values (
        ${eventId}, ${ownerId}, ${title}, 'Original description', ${status}, 'discoverable', 1,
        clock_timestamp() + make_interval(secs => ${opensOffsetSeconds}),
        clock_timestamp() + make_interval(secs => ${closesOffsetSeconds})
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

  const [row] = await sql`
    select opens_at, closes_at, draft_version, edited_at from events where id = ${eventId}
  `;
  return {
    eventId,
    questionId,
    optionIds,
    opensAt: new Date(row.opens_at),
    closesAt: new Date(row.closes_at),
    draftVersion: Number(row.draft_version),
  };
}

type EditInput = Parameters<NonNullable<typeof updatePublishedQuiz>>[0];

function editInput(fixture: Fixture, overrides: Partial<EditInput> = {}): EditInput {
  return {
    eventId: fixture.eventId,
    expectedDraftVersion: fixture.draftVersion,
    title: "Edited title",
    description: "Edited description",
    opensAt: fixture.opensAt.toISOString(),
    closesAt: fixture.closesAt.toISOString(),
    coverKind: "none",
    coverRef: null,
    coverMeta: null,
    ...overrides,
  };
}

async function eventRow(eventId: string) {
  if (!sql) throw new Error("Integration database is not enabled");
  const [row] = await sql`
    select title, description, status, draft_version, edited_at, updated_at, created_at,
           opens_at, closes_at, cover_kind, cover_ref
    from events where id = ${eventId}
  `;
  return row;
}

async function ballot(fixture: Fixture) {
  if (!submitVote || !sql) throw new Error("Integration database is not enabled");
  mocks.sessionUserId = ownerId;
  const result = await submitVote({
    eventId: fixture.eventId,
    answers: [{ questionId: fixture.questionId, optionIds: [fixture.optionIds[0]] }],
    guestHandle: "owner-ballot",
    guestHandlePlatform: "x",
  });
  expect(result).toMatchObject({ ok: true });
}

describe.skipIf(!enabled)("updatePublishedQuiz", () => {
  beforeAll(async () => {
    if (!sql) return;
    await createUser(ownerId);
    await createUser(otherId);
  });

  afterEach(async () => {
    if (!sql) return;
    for (const eventId of eventIds.splice(0)) {
      await sql`delete from events where id = ${eventId}`;
    }
    mocks.sessionUserId = ownerId;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from "user" where id in (${ownerId}, ${otherId})`;
    await sql.end();
  });

  it("lets the owner edit title, description and cover, and marks the poll edited", async () => {
    if (!sql || !updatePublishedQuiz) throw new Error("Integration database is not enabled");
    const fixture = await createPoll();
    mocks.sessionUserId = ownerId;

    const result = await updatePublishedQuiz(
      editInput(fixture, {
        title: "Renamed poll",
        description: "New description",
        coverKind: "preset",
        coverRef: "linen",
      }),
    );

    expect(result).toMatchObject({ ok: true, edited: true });
    if (!result.ok) return;
    const row = await eventRow(fixture.eventId);
    expect(row.title).toBe("Renamed poll");
    expect(row.description).toBe("New description");
    expect(row.cover_kind).toBe("preset");
    expect(row.cover_ref).toBe("linen");
    expect(Number(row.draft_version)).toBe(fixture.draftVersion + 1);
    expect(row.edited_at).not.toBeNull();
    expect(new Date(row.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(row.created_at).getTime(),
    );
  });

  it("rejects edits from anyone but the owner and does not touch the row", async () => {
    if (!updatePublishedQuiz) throw new Error("Integration database is not enabled");
    const fixture = await createPoll();
    mocks.sessionUserId = otherId;

    const result = await updatePublishedQuiz(editInput(fixture, { title: "Hijacked title" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.formError).toMatch(/isn’t available/);
    const row = await eventRow(fixture.eventId);
    expect(row.title).toBe("Editable poll");
    expect(row.edited_at).toBeNull();
  });

  it("sends drafts back to the builder instead of editing them as published polls", async () => {
    if (!sql || !updatePublishedQuiz) throw new Error("Integration database is not enabled");
    const eventId = crypto.randomUUID();
    eventIds.push(eventId);
    await sql`
      insert into events (id, creator_user_id, title, status, visibility, opens_at, closes_at)
      values (
        ${eventId}, ${ownerId}, 'Draft poll', 'draft', 'unlisted',
        clock_timestamp() + interval '1 hour', clock_timestamp() + interval '2 hours'
      )
    `;
    const fixture: Fixture = {
      eventId,
      questionId: crypto.randomUUID(),
      optionIds: [],
      opensAt: new Date(Date.now() + 60 * 60 * 1000),
      closesAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      draftVersion: 1,
    };
    mocks.sessionUserId = ownerId;

    const result = await updatePublishedQuiz(editInput(fixture, { title: "Should not apply" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.formError).toMatch(/builder/);
    const row = await eventRow(eventId);
    expect(row.title).toBe("Draft poll");
  });

  it("allows details on a closed poll but rejects date changes", async () => {
    if (!updatePublishedQuiz) throw new Error("Integration database is not enabled");
    const fixture = await createPoll({
      status: "closed",
      opensOffsetSeconds: -7_200,
      closesOffsetSeconds: -3_600,
    });
    mocks.sessionUserId = ownerId;

    const details = await updatePublishedQuiz(
      editInput(fixture, { title: "Closed but renamed", description: "Still editable" }),
    );
    expect(details).toMatchObject({ ok: true, edited: true });

    const dates = await updatePublishedQuiz(
      editInput(fixture, {
        expectedDraftVersion: fixture.draftVersion + 1,
        title: "Closed but renamed",
        description: "Still editable",
        closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    );
    expect(dates.ok).toBe(false);
    if (dates.ok) return;
    expect(dates.errors.closesAt).toMatch(/already closed/);

    const row = await eventRow(fixture.eventId);
    expect(row.title).toBe("Closed but renamed");
  });

  it("requires the closing time to be in the future and after the opening time", async () => {
    if (!updatePublishedQuiz) throw new Error("Integration database is not enabled");
    mocks.sessionUserId = ownerId;

    const open = await createPoll();
    const pastClose = await updatePublishedQuiz(
      editInput(open, {
        closesAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    expect(pastClose.ok).toBe(false);
    if (pastClose.ok) return;
    expect(pastClose.errors.closesAt).toMatch(/future/);

    const scheduled = await createPoll({
      status: "scheduled",
      opensOffsetSeconds: 3_600,
      closesOffsetSeconds: 7_200,
    });
    const beforeOpen = await updatePublishedQuiz(
      editInput(scheduled, {
        expectedDraftVersion: scheduled.draftVersion,
        closesAt: new Date(scheduled.opensAt.getTime() - 30 * 60 * 1000).toISOString(),
      }),
    );
    expect(beforeOpen.ok).toBe(false);
    if (beforeOpen.ok) return;
    expect(beforeOpen.errors.closesAt).toMatch(/after opening/);
  });

  it("freezes the start time once the poll has opened", async () => {
    if (!updatePublishedQuiz) throw new Error("Integration database is not enabled");
    const fixture = await createPoll();
    mocks.sessionUserId = ownerId;

    const movedEarlier = await updatePublishedQuiz(
      editInput(fixture, {
        opensAt: new Date(fixture.opensAt.getTime() - 60_000).toISOString(),
      }),
    );

    expect(movedEarlier.ok).toBe(false);
    if (movedEarlier.ok) return;
    expect(movedEarlier.errors.opensAt).toMatch(/already opened/);
  });

  it("moves a scheduled quiz either way before opening and keeps status and phase consistent", async () => {
    if (!updatePublishedQuiz || !getEventPhase) {
      throw new Error("Integration database is not enabled");
    }
    mocks.sessionUserId = ownerId;
    const later = new Date(Date.now() + 90 * 60 * 1000);
    const fixture = await createPoll({
      status: "scheduled",
      opensOffsetSeconds: 3_600,
      closesOffsetSeconds: 7_200,
    });

    const pushedBack = await updatePublishedQuiz(
      editInput(fixture, { opensAt: later.toISOString() }),
    );
    expect(pushedBack.ok).toBe(true);
    const [stored] = await sql!`select status, opens_at from events where id = ${fixture.eventId}`;
    expect(stored.status).toBe("scheduled");

    const movedToPast = await updatePublishedQuiz(
      editInput(fixture, {
        expectedDraftVersion: fixture.draftVersion + 1,
        opensAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    expect(movedToPast.ok).toBe(true);

    const row = await eventRow(fixture.eventId);
    const [{ now }] = await sql!`select clock_timestamp() as now`;
    expect(row.status).toBe("open");
    expect(
      getEventPhase(
        {
          status: String(row.status),
          opensAt: new Date(row.opens_at),
          closesAt: new Date(row.closes_at),
        },
        new Date(now),
      ),
    ).toBe("live");
  });

  it("locks question payloads and identity fields once ballots exist", async () => {
    if (!updatePublishedQuiz) throw new Error("Integration database is not enabled");
    const fixture = await createPoll();
    await ballot(fixture);

    const details = await updatePublishedQuiz(
      editInput(fixture, { title: "Edited after a ballot" }),
    );
    expect(details).toMatchObject({ ok: true, edited: true });

    const withQuestions = await updatePublishedQuiz(
      editInput(fixture, {
        expectedDraftVersion: fixture.draftVersion + 1,
        title: "Edited after a ballot",
        questions: [
          {
            prompt: "Changed question",
            description: "",
            pickType: "single",
            maxPicks: 1,
            options: [
              { label: "A", description: "", imageSource: "none", imageUrl: "", imageBlobKey: "", imageAlt: "" },
              { label: "B", description: "", imageSource: "none", imageUrl: "", imageBlobKey: "", imageAlt: "" },
            ],
          },
        ],
      }),
    );
    expect(withQuestions.ok).toBe(false);
    if (withQuestions.ok) return;
    expect(withQuestions.errors.questions).toMatch(/after the first response/);

    for (const locked of [{ slug: "taken-link" }, { visibility: "unlisted" }, { passcode: "1234" }]) {
      const attempt = await updatePublishedQuiz(
        editInput(fixture, {
          expectedDraftVersion: fixture.draftVersion + 2,
          title: "Edited after a ballot",
          ...locked,
        } as unknown as EditInput),
      );
      expect(attempt.ok).toBe(false);
      if (attempt.ok) return;
      expect(attempt.formError).toMatch(/can’t be changed after publishing/);
    }

    const [question] = await sql!`
      select prompt from questions where id = ${fixture.questionId}
    `;
    expect(question.prompt).toBe("Pick one");
  });

  it("still lets the owner rewrite questions before the first ballot", async () => {
    if (!updatePublishedQuiz || !sql) throw new Error("Integration database is not enabled");
    const fixture = await createPoll();
    mocks.sessionUserId = ownerId;

    const result = await updatePublishedQuiz(
      editInput(fixture, {
        title: "Edited before ballots",
        questions: [
          {
            prompt: "New prompt",
            description: "",
            pickType: "single",
            maxPicks: 1,
            options: [
              { label: "New A", description: "", imageSource: "none", imageUrl: "", imageBlobKey: "", imageAlt: "" },
              { label: "New B", description: "", imageSource: "none", imageUrl: "", imageBlobKey: "", imageAlt: "" },
            ],
          },
        ],
      }),
    );

    expect(result).toMatchObject({ ok: true, edited: true });
    const [question] = await sql`
      select prompt from questions where event_id = ${fixture.eventId}
    `;
    expect(question.prompt).toBe("New prompt");
    const options = await sql`
      select label from options o join questions q on q.id = o.question_id
      where q.event_id = ${fixture.eventId} order by o.sort_order
    `;
    expect(options.map((row) => row.label)).toEqual(["New A", "New B"]);
  });

  it("rejects removing the last option of a published quiz even without ballots", async () => {
    if (!updatePublishedQuiz || !sql) throw new Error("Integration database is not enabled");
    const fixture = await createPoll();
    mocks.sessionUserId = ownerId;

    const actionAttempt = await updatePublishedQuiz(
      editInput(fixture, {
        questions: [
          {
            prompt: "Pick one",
            description: "",
            pickType: "single",
            maxPicks: 1,
            options: [
              { label: "Only option", description: "", imageSource: "none", imageUrl: "", imageBlobKey: "", imageAlt: "" },
            ],
          },
        ],
      }),
    );
    expect(actionAttempt.ok).toBe(false);

    const [{ count }] = await sql`
      select count(*)::int as count from options o
      join questions q on q.id = o.question_id
      where q.event_id = ${fixture.eventId}
    `;
    expect(Number(count)).toBe(2);

    // The deferred published-shape trigger is the database backstop.
    await expect(
      sql.begin(async (tx) => {
        await tx`delete from options where id = ${fixture.optionIds[0]}`;
      }),
    ).rejects.toThrow();

    const [{ count: after }] = await sql`
      select count(*)::int as count from options o
      join questions q on q.id = o.question_id
      where q.event_id = ${fixture.eventId}
    `;
    expect(Number(after)).toBe(2);
  });

  it("does not mark a poll edited on a no-op save, a ballot, or close-early", async () => {
    if (!updatePublishedQuiz || !closeEvent) {
      throw new Error("Integration database is not enabled");
    }
    mocks.sessionUserId = ownerId;
    const fixture = await createPoll();
    const first = await updatePublishedQuiz(editInput(fixture, { title: "Marker baseline" }));
    expect(first.ok).toBe(true);
    const afterFirst = await eventRow(fixture.eventId);

    const noOp = await updatePublishedQuiz(
      editInput(fixture, {
        expectedDraftVersion: fixture.draftVersion + 1,
        title: "Marker baseline",
        description: afterFirst.description as string,
      }),
    );
    expect(noOp).toMatchObject({ ok: true, edited: false });
    const afterNoOp = await eventRow(fixture.eventId);
    expect(new Date(afterNoOp.edited_at).getTime()).toBe(new Date(afterFirst.edited_at).getTime());

    const scheduled = await createPoll({
      status: "scheduled",
      opensOffsetSeconds: -60,
      closesOffsetSeconds: 3_600,
    });
    await ballot(scheduled);
    const [voted] = await sql!`select status, edited_at from events where id = ${scheduled.eventId}`;
    expect(voted.status).toBe("open");
    expect(voted.edited_at).toBeNull();

    mocks.sessionUserId = ownerId;
    const closed = await closeEvent(fixture.eventId);
    expect(closed).toEqual({ ok: true });
    const [afterClose] = await sql!`select edited_at from events where id = ${fixture.eventId}`;
    expect(new Date(afterClose.edited_at).getTime()).toBe(new Date(afterFirst.edited_at).getTime());
  });
});
