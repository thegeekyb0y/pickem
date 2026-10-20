/**
 * Seeds a disposable open poll in the load-test branch so the k6 scenarios have
 * a poll and an option to exercise. Refuses to run against the production
 * database host. Connection strings and credentials are never printed.
 *
 * Usage:
 *   node scripts/load/seed.mjs            # creates a poll and prints its ids
 *   node scripts/load/seed.mjs --cleanup   # removes a previously seeded poll
 *
 * Required environment:
 *   DATABASE_URL_TEST       disposable branch URL (direct, not pooled)
 *   ALLOW_TEST_DB_MUTATION  must be "1"
 *   PRODUCTION_DATABASE_HOST (or PRODUCTION_DATABASE_URL / DATABASE_URL / .env.local)
 *                           used only to compare hostnames against the target
 */

import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { guardAgainstProductionDatabase } from "./db-guard.mjs";

const SEED_MARKER = "k6 load test seed";

// Load local values quietly; process environment always wins.
loadEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true, override: false });

function readFlag(name) {
  return process.argv.includes(name);
}

function resolveTargetUrl() {
  const fromEnv = process.env.DATABASE_URL_TEST?.trim();
  if (fromEnv) return fromEnv;
  return process.env.DATABASE_URL_TEST?.trim() || null;
}

async function main() {
  if (process.env.ALLOW_TEST_DB_MUTATION !== "1") {
    throw new Error(
      "Refusing to seed: set ALLOW_TEST_DB_MUTATION=1 to confirm this is a disposable branch.",
    );
  }

  guardAgainstProductionDatabase({ label: "the load-test seed script" });

  const targetUrl = resolveTargetUrl();
  if (!targetUrl) {
    throw new Error("DATABASE_URL_TEST is required and must point at a disposable branch.");
  }

  const sql = postgres(targetUrl, { max: 1, prepare: false });

  try {
    if (readFlag("--cleanup")) {
      const deleted = await sql`
        delete from events
        where title = ${SEED_MARKER}
        returning id
      `;
      console.log(`Removed ${deleted.length} seeded poll(s).`);
      return;
    }

    const userId = `pickem-load-seed-${randomUUID()}`;
    const eventId = randomUUID();
    const optionIds = [randomUUID(), randomUUID()];

    await sql`
      insert into "user" (id, name, email, email_verified)
      values (${userId}, 'Pickem Load Seed', ${`${userId}@example.test`}, false)
    `;
    await sql`
      insert into events (
        id, creator_user_id, title, description, status, visibility,
        pick_type, max_picks, opens_at, closes_at
      ) values (
        ${eventId}, ${userId}, ${SEED_MARKER}, 'Disposable poll for load testing',
        'open', 'discoverable', 'single', 1,
        clock_timestamp() - interval '1 hour', clock_timestamp() + interval '2 hours'
      )
    `;
    for (const [index, optionId] of optionIds.entries()) {
      await sql`
        insert into options (id, event_id, label, sort_order)
        values (${optionId}, ${eventId}, ${`Load option ${index + 1}`}, ${index})
      `;
    }

    console.log("Seeded a disposable poll in the load-test branch.");
    console.log(`POLL_ID=${eventId}`);
    console.log(`OPTION_ID=${optionIds[0]}`);
    console.log("Cleanup with: node scripts/load/seed.mjs --cleanup");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "The load-test seed failed.");
  process.exit(1);
});
