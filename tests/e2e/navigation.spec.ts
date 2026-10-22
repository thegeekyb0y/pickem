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

test("root remains Discover and navigation links to /discover", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(page.getByRole("heading", { name: "Discover quizzes" })).toBeVisible();
  await expect(mobileNav.getByRole("link", { name: "Discover" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(mobileNav.getByRole("link", { name: "Create" })).toHaveAttribute("href", "/events/new");
  await expect(mobileNav.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(mobileNav.getByRole("link", { name: "Profile" })).toHaveCount(0);

  await page.goto("/discover?view=closed");
  await expect(page.getByRole("heading", { name: "Discover quizzes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Closed" })).toHaveAttribute("aria-current", "page");
});

test("mobile vote submit bar stacks above the bottom navigation", async ({ baseURL, browser }) => {
  if (!baseURL) return;
  const sql = connectToTestDatabase();
  const fixture = await createPollFixture(sql);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

  try {
    const mobilePage = await context.newPage();
    await mobilePage.goto(`${baseURL}/events/${fixture.eventId}`);

    const tabs = mobilePage.getByRole("navigation", { name: "Mobile navigation" });
    const submitBar = mobilePage.getByTestId("vote-submit-bar");
    await expect(tabs).toBeVisible();
    await expect(submitBar).toBeVisible();

    const tabsBox = await tabs.boundingBox();
    const submitBox = await submitBar.boundingBox();
    expect(tabsBox).not.toBeNull();
    expect(submitBox).not.toBeNull();
    expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(tabsBox!.y + 1);
  } finally {
    await context.close();
    await removePollFixture(sql, fixture);
    await sql.end();
  }
});
