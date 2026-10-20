import { expect, test } from "@playwright/test";
import {
  assertE2eTargetIsNotProduction,
  connectToTestDatabase,
  createPollFixture,
  e2eEnabled,
  removePollFixture,
} from "./support/poll-fixtures";

test.skip(!e2eEnabled, "Requires DATABASE_URL_TEST and ALLOW_TEST_DB_MUTATION=1");

test.beforeAll(() => {
  if (e2eEnabled) assertE2eTargetIsNotProduction();
});

test("a second browser context receives live ballot updates without refresh", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) return;
  const sql = connectToTestDatabase();
  const fixture = await createPollFixture(sql);
  let contextA: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let contextB: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    contextA = await browser.newContext();
    contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const eventUrl = `${baseURL}/events/${fixture.eventId}`;
    await Promise.all([pageA.goto(eventUrl), pageB.goto(eventUrl)]);

    await expect(pageB.getByTestId("ballot-count")).toContainText("0 ballots");
    await pageA.getByRole("button", { name: "E2E option 1" }).click();
    await pageA.getByLabel("Social handle").fill("pickem-e2e");
    await pageA.getByRole("button", { name: "Submit final ballot" }).click();
    // The dev server compiles the server action on first use, so allow time.
    await expect(pageA.getByText(/Ballot submitted/)).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByTestId("ballot-count")).toContainText("1 ballot", { timeout: 20_000 });
  } finally {
    await contextA?.close();
    await contextB?.close();
    await removePollFixture(sql, fixture);
    await sql.end();
  }
});
