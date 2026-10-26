import { expect, test, type Page } from "@playwright/test";
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

async function submitBallot(page: Page) {
  await page.getByRole("button", { name: "E2E option 1" }).click();
  await page.getByLabel("Social handle").fill("pickem-e2e");
  await page.getByRole("button", { name: "Submit answers" }).click();
  // The dev server compiles the server action on first use, so allow time.
  await expect(page.getByText(/Answers submitted/)).toBeVisible({ timeout: 30_000 });
}

/**
 * The Discover/home card reads from the `home:polls` data cache. Every ballot
 * must expire that cache with a blocking revalidation; otherwise the card keeps
 * showing the snapshot taken before those responses were submitted.
 */
test("ballots update the Discover card counts on the next visit", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) return;
  const sql = connectToTestDatabase();
  const fixture = await createPollFixture(sql);
  const title = `E2E poll ${fixture.eventId.slice(0, 8)}`;
  const eventUrl = `${baseURL}/events/${fixture.eventId}`;
  const cardFor = (page: Page) =>
    page.getByRole("link", { name: title }).locator("xpath=ancestor::article");

  let firstContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let secondContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    // The first ballot also replaces any listing snapshot cached before this
    // fixture existed, so the second ballot starts from a known state.
    firstContext = await browser.newContext();
    const firstPage = await firstContext.newPage();
    await firstPage.goto(eventUrl);
    await submitBallot(firstPage);
    await firstPage.goto(`${baseURL}/`);
    await expect(cardFor(firstPage)).toContainText("1 question");
    await expect(cardFor(firstPage)).toContainText("1 response");

    secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(eventUrl);
    await submitBallot(secondPage);
    await secondPage.goto(`${baseURL}/`);
    await expect(cardFor(secondPage)).toContainText("2 responses");
  } finally {
    await firstContext?.close();
    await secondContext?.close();
    await removePollFixture(sql, fixture);
    await sql.end();
  }
});
