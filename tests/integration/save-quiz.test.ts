import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyTestDatabaseUrl, resolveTestDatabaseUrl } from "../helpers/local-env";

const mocks = vi.hoisted(() => ({
  sessionUserId: null as string | null,
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
  limitQuizCoverUpload: async () => true,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const testUrl = resolveTestDatabaseUrl();
const enabled = Boolean(testUrl && process.env.ALLOW_TEST_DB_MUTATION === "1");
if (enabled && testUrl) {
  applyTestDatabaseUrl(testUrl);
}

type SqlClient = ReturnType<typeof postgres>;

let sql: SqlClient | undefined;
let saveQuiz: typeof import("@/lib/events/actions").saveQuiz | undefined;
const userId = `pickem-save-quiz-${crypto.randomUUID()}`;

if (enabled && testUrl) {
  sql = postgres(testUrl, { max: 2, prepare: false });
  ({ saveQuiz } = await import("@/lib/events/actions"));
}

describe.skipIf(!enabled)("saveQuiz", () => {
  beforeAll(async () => {
    if (!sql) return;
    mocks.sessionUserId = userId;
    await sql`
      insert into "user" (id, name, email, email_verified)
      values (${userId}, 'Draft owner', ${`${userId}@example.test`}, false)
    `;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from events where creator_user_id = ${userId}`;
    await sql`delete from "user" where id = ${userId}`;
    await sql.end();
  });

  it("creates, updates, and publishes a draft without trigger or timestamp failures", async () => {
    if (!sql || !saveQuiz) throw new Error("Integration database is not enabled");

    const opensAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const closesAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const baseInput = {
      eventId: null,
      expectedDraftVersion: null,
      saveAs: "draft" as const,
      draftStep: 1,
      title: "Timestamp regression poll",
      description: "",
      opensAt,
      closesAt,
      visibility: "unlisted" as const,
      passcode: "",
      coverKind: "none" as const,
      coverRef: null,
      coverMeta: null,
      questions: [
        {
          prompt: "Pick one",
          description: "",
          pickType: "single" as const,
          maxPicks: 1,
          options: [
            {
              label: "First",
              description: "",
              imageSource: "none" as const,
              imageUrl: "",
              imageBlobKey: "",
              imageAlt: "",
            },
            {
              label: "Second",
              description: "",
              imageSource: "none" as const,
              imageUrl: "",
              imageBlobKey: "",
              imageAlt: "",
            },
          ],
        },
      ],
    };

    const draft = await saveQuiz(baseInput);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const [storedDraft] = await sql`
      select status, draft_version from events where id = ${draft.eventId}
    `;
    expect(storedDraft.status).toBe("draft");
    expect(storedDraft.draft_version).toBe(1);

    const timestampRows = await sql`
      select 'question' as kind, q.created_at, q.updated_at
      from questions q
      where q.event_id = ${draft.eventId}
      union all
      select 'option' as kind, o.created_at, o.updated_at
      from options o
      join questions q on q.id = o.question_id
      where q.event_id = ${draft.eventId}
    `;
    expect(timestampRows).toHaveLength(3);
    for (const row of timestampRows) {
      expect(new Date(row.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(row.created_at).getTime(),
      );
    }

    const updated = await saveQuiz({
      ...baseInput,
      eventId: draft.eventId,
      expectedDraftVersion: draft.draftVersion,
      saveAs: "draft",
      draftStep: 2,
      title: "Timestamp regression poll updated",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    const [storedUpdated] = await sql`
      select status, draft_version from events where id = ${updated.eventId}
    `;
    expect(storedUpdated.status).toBe("draft");
    expect(storedUpdated.draft_version).toBe(2);

    const published = await saveQuiz({
      ...baseInput,
      eventId: updated.eventId,
      expectedDraftVersion: updated.draftVersion,
      saveAs: "publish",
      draftStep: 3,
      title: "Timestamp regression poll updated",
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    const [storedPublished] = await sql`
      select status, draft_version from events where id = ${published.eventId}
    `;
    expect(storedPublished.status).toBe("scheduled");
    expect(storedPublished.draft_version).toBe(3);
  });
});
