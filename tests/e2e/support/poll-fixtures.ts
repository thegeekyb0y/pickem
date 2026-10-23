import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import postgres from "postgres";
import {
  assertNotProductionDatabase,
  resolveProductionDatabaseHost,
  resolveTargetDatabaseHost,
} from "../../../scripts/db-guard.mjs";
import { resolveTestDatabaseUrl } from "../../helpers/local-env";

const scrypt = promisify(scryptCallback);

type SqlClient = ReturnType<typeof postgres>;

export const e2eEnabled =
  process.env.ALLOW_TEST_DB_MUTATION === "1" && Boolean(resolveTestDatabaseUrl());
/**
 * Pre-flight guard: refuse to run the E2E suite when the target database host
 * is the production database host. Hostnames are compared only; no connection
 * string is ever logged.
 */
export function assertE2eTargetIsNotProduction(): void {
  assertNotProductionDatabase({
    label: "the end-to-end suite",
    targetHost: resolveTargetDatabaseHost(),
    productionHost: resolveProductionDatabaseHost(),
  });
}

export function connectToTestDatabase(): SqlClient {
  const url = resolveTestDatabaseUrl();
  if (!url) throw new Error("DATABASE_URL_TEST is required for the end-to-end suite.");
  return postgres(url, { max: 1, prepare: false });
}

export async function hashPasscode(code: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(code, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export type PollFixture = {
  eventId: string;
  userId: string;
  questionId: string;
  optionIds: string[];
};

export async function createPollFixture(
  sql: SqlClient,
  {
    visibility = "discoverable",
    passcode,
    pickType = "single",
    maxPicks = 1,
  }: { visibility?: string; passcode?: string; pickType?: string; maxPicks?: number } = {},
): Promise<PollFixture> {
  const eventId = randomUUID();
  const userId = `pickem-e2e-${randomUUID()}`;
  const questionId = randomUUID();
  const optionIds = [randomUUID(), randomUUID()];
  const email = `${userId}@example.test`;

  await sql`
    insert into "user" (id, name, email, email_verified)
    values (${userId}, 'Pickem E2E', ${email}, false)
  `;
  // The event and its options must be created in one transaction: the top-N
  // constraint trigger is deferred to commit and counts the options.
  await sql.begin(async (tx) => {
    await tx`
      insert into events (
        id, creator_user_id, title, description, status, visibility, passcode_hash,
        opens_at, closes_at
      ) values (
        ${eventId}, ${userId}, ${`E2E quiz ${eventId.slice(0, 8)}`},
        'Playwright fixture', 'open', ${visibility},
        ${passcode ? await hashPasscode(passcode) : null},
        clock_timestamp() - interval '1 minute', clock_timestamp() + interval '15 minutes'
      )
    `;
    await tx`
      insert into questions (id, event_id, prompt, pick_type, max_picks, sort_order)
      values (${questionId}, ${eventId}, 'Choose a prediction', ${pickType}, ${maxPicks}, 0)
    `;
    for (const [index, optionId] of optionIds.entries()) {
      await tx`
        insert into options (id, question_id, label, sort_order)
        values (${optionId}, ${questionId}, ${`E2E option ${index + 1}`}, ${index})
      `;
    }
  });

  return { eventId, userId, questionId, optionIds };
}

export async function removePollFixture(sql: SqlClient, fixture: PollFixture) {
  await sql`delete from events where id = ${fixture.eventId}`;
  await sql`delete from "user" where id = ${fixture.userId}`;
}
