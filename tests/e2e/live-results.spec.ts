import postgres from "postgres";
import { expect, test } from "@playwright/test";

const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const enabled = process.env.ALLOW_TEST_DB_MUTATION === "1" && Boolean(testDatabaseUrl);

test.skip(!enabled, "Requires DATABASE_URL_TEST and ALLOW_TEST_DB_MUTATION=1");

test("a second browser context receives live ballot updates without refresh", async ({ browser, baseURL }) => {
  if (!testDatabaseUrl || !baseURL) return;
  const sql = postgres(testDatabaseUrl, { max: 1, prepare: false });
  const eventId = crypto.randomUUID();
  const userId = `pickem-e2e-${crypto.randomUUID()}`;
  const optionIds = [crypto.randomUUID(), crypto.randomUUID()];
  const email = `${userId}@example.test`;
  let contextA: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let contextB: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    await sql`
      insert into "user" (id, name, email, email_verified)
      values (${userId}, 'Pickem E2E', ${email}, false)
    `;
    await sql`
      insert into events (
        id, creator_user_id, title, description, status, visibility,
        pick_type, max_picks, opens_at, closes_at
      ) values (
        ${eventId}, ${userId}, ${`Live update test ${eventId.slice(0, 8)}`},
        'Playwright live results fixture', 'open', 'discoverable', 'single', 1,
        clock_timestamp() - interval '1 minute', clock_timestamp() + interval '15 minutes'
      )
    `;
    for (const [index, optionId] of optionIds.entries()) {
      await sql`
        insert into options (id, event_id, label, sort_order)
        values (${optionId}, ${eventId}, ${`E2E option ${index + 1}`}, ${index})
      `;
    }

    contextA = await browser.newContext();
    contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const eventUrl = `${baseURL}/events/${eventId}`;
    await Promise.all([pageA.goto(eventUrl), pageB.goto(eventUrl)]);

    await expect(pageB.getByTestId("ballot-count")).toContainText("0 ballots");
    await pageA.getByRole("button", { name: "E2E option 1" }).click();
    await pageA.getByLabel("Social handle").fill("pickem-e2e");
    await pageA.getByRole("button", { name: "Submit final ballot" }).click();
    await expect(pageA.getByText(/Ballot submitted/)).toBeVisible();
    await expect(pageB.getByTestId("ballot-count")).toContainText("1 ballot", { timeout: 10_000 });
  } finally {
    await contextA?.close();
    await contextB?.close();
    await sql`delete from events where id = ${eventId}`;
    await sql`delete from "user" where id = ${userId}`;
    await sql.end();
  }
});
