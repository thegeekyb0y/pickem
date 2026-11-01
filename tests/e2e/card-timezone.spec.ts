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

/**
 * Cards are rendered on the server, whose timezone is usually UTC, while the
 * poll page already formats in the viewer's zone. A viewer must see their own
 * local time with a zone label, not the host's.
 */
test("Discover card times follow the viewer's timezone", async ({ browser, baseURL }) => {
  if (!baseURL) return;
  const sql = connectToTestDatabase();
  const fixture = await createPollFixture(sql);
  const title = `E2E poll ${fixture.eventId.slice(0, 8)}`;
  const [stored] = await sql`
    select closes_at from events where id = ${fixture.eventId}
  `;
  const closesAt = new Date(stored.closes_at as string | Date);
  const expected = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/New_York",
  }).format(closesAt);

  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/New_York",
  });
  const page = await context.newPage();

  try {
    // A ballot expires the `home:polls` listing cache, so the fresh fixture is
    // guaranteed to be on the next Discover visit.
    await page.goto(`${baseURL}/events/${fixture.eventId}`);
    await page.getByRole("button", { name: "E2E option 1" }).click();
    await page.getByLabel("Social handle").fill("pickem-e2e");
    await page.getByRole("button", { name: "Submit answers" }).click();
    await expect(page.getByText(/Answers submitted/)).toBeVisible({ timeout: 30_000 });

    await page.goto(`${baseURL}/discover`);
    const card = page.getByRole("link", { name: title }).locator("xpath=ancestor::article");
    await expect(card).toContainText(expected);
  } finally {
    await context.close();
    await removePollFixture(sql, fixture);
    await sql.end();
  }
});
