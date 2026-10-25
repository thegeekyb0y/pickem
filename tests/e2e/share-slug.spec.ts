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

test("a share slug resolves the poll and the UUID route still works", async ({
  page,
  baseURL,
}) => {
  if (!baseURL) return;
  const sql = connectToTestDatabase();
  const slug = `e2e-${crypto.randomUUID().slice(0, 8)}`;
  const fixture = await createPollFixture(sql, { slug });
  const title = `E2E poll ${fixture.eventId.slice(0, 8)}`;

  try {
    await page.goto(`${baseURL}/events/${slug}`);
    await expect(page).toHaveURL(new RegExp(`/events/${slug}$`));
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByTestId("ballot-count")).toBeVisible();

    // The UUID route remains a working fallback for the same poll.
    await page.goto(`${baseURL}/events/${fixture.eventId}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  } finally {
    await removePollFixture(sql, fixture);
    await sql.end();
  }
});
