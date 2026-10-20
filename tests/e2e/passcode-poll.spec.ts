import { expect, test } from "@playwright/test";
import {
  assertE2eTargetIsNotProduction,
  connectToTestDatabase,
  createPollFixture,
  e2eEnabled,
  removePollFixture,
} from "./support/poll-fixtures";

const PASSCODE = "e2e-passcode";

test.skip(!e2eEnabled, "Requires DATABASE_URL_TEST and ALLOW_TEST_DB_MUTATION=1");

test.beforeAll(() => {
  if (e2eEnabled) assertE2eTargetIsNotProduction();
});

test("a passcode poll stays locked until the passcode is entered", async ({ browser, baseURL }) => {
  if (!baseURL) return;
  const sql = connectToTestDatabase();
  const fixture = await createPollFixture(sql, { visibility: "passcode", passcode: PASSCODE });
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    context = await browser.newContext();
    const page = await context.newPage();
    const eventUrl = `${baseURL}/events/${fixture.eventId}`;

    // The results endpoint is locked before the passcode is entered.
    const locked = await context.request.get(`${baseURL}/api/events/${fixture.eventId}/results`);
    expect(locked.status()).toBe(401);

    await page.goto(eventUrl);
    await expect(page.getByRole("heading", { name: "Enter the passcode" })).toBeVisible();

    // A wrong passcode keeps the poll locked.
    await page.getByLabel("Passcode").fill("not-the-passcode");
    await page.getByRole("button", { name: "Unlock poll" }).click();
    await expect(page.getByRole("alert")).toContainText("didn’t match");

    const stillLocked = await context.request.get(
      `${baseURL}/api/events/${fixture.eventId}/results`,
    );
    expect(stillLocked.status()).toBe(401);

    // The correct passcode unlocks the poll.
    await page.getByLabel("Passcode").fill(PASSCODE);
    await page.getByRole("button", { name: "Unlock poll" }).click();
    await expect(page.getByRole("heading", { name: /E2E poll/ })).toBeVisible();

    const unlocked = await context.request.get(`${baseURL}/api/events/${fixture.eventId}/results`);
    expect(unlocked.status()).toBe(200);
    expect(unlocked.headers()["cache-control"]).toContain("no-store");

    // A fresh context without the unlock cookie is still locked.
    const otherContext = await browser.newContext();
    try {
      const otherLocked = await otherContext.request.get(
        `${baseURL}/api/events/${fixture.eventId}/results`,
      );
      expect(otherLocked.status()).toBe(401);
    } finally {
      await otherContext.close();
    }
  } finally {
    await context?.close();
    await removePollFixture(sql, fixture);
    await sql.end();
  }
});
