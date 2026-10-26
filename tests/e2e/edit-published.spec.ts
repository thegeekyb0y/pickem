import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
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
 * Better Auth signs the session token as `<token>.<base64 HMAC-SHA256>`.
 * A database session plus that cookie is equivalent to a signed-in owner
 * without going through Google OAuth.
 */
async function signInAsOwner(
  sql: ReturnType<typeof connectToTestDatabase>,
  context: BrowserContext,
  baseURL: string,
  userId: string,
) {
  const token = `e2e-${randomUUID()}`;
  await sql`
    insert into session (id, expires_at, token, user_id, created_at, updated_at)
    values (
      ${randomUUID()}, clock_timestamp() + interval '1 hour', ${token}, ${userId},
      clock_timestamp(), clock_timestamp()
    )
  `;
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "pickem-e2e-test-secret")
    .update(token)
    .digest("base64");
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: `${token}.${signature}`,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function expectEditedTitle(page: Page, title: string) {
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(/Edited/).first()).toBeVisible();
}

test("an owner edits a published poll and the listing reflects it", async ({
  page,
  baseURL,
}) => {
  if (!baseURL) return;
  const sql = connectToTestDatabase();
  const fixture = await createPollFixture(sql, { visibility: "discoverable" });
  const originalTitle = `E2E poll ${fixture.eventId.slice(0, 8)}`;
  const editedTitle = `E2E edited ${fixture.eventId.slice(0, 8)}`;

  try {
    await signInAsOwner(sql, page.context(), baseURL, fixture.userId);

    await page.goto(`${baseURL}/events/${fixture.eventId}`);
    await expect(page.getByRole("heading", { name: originalTitle })).toBeVisible();

    await page.getByRole("link", { name: "Edit poll" }).click();
    await expect(page).toHaveURL(new RegExp(`/events/${fixture.eventId}/edit$`));
    await expect(page.getByRole("heading", { name: "Edit poll", exact: true })).toBeVisible();

    // Links, visibility and passcodes are read-only after publishing.
    await expect(page.getByLabel("Visibility")).toHaveCount(0);
    await expect(page.getByText("Links, visibility and passcodes are locked after publishing.")).toBeVisible();

    await page.getByLabel("Poll title").fill(editedTitle);
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(new RegExp(`/events/${fixture.eventId}$`));
    await expectEditedTitle(page, editedTitle);

    const [stored] = await sql`
      select title, edited_at, draft_version from events where id = ${fixture.eventId}
    `;
    expect(stored.title).toBe(editedTitle);
    expect(stored.edited_at).not.toBeNull();
    expect(Number(stored.draft_version)).toBe(2);

    // The Discover listing (home:polls cache) is invalidated by the edit.
    await page.goto(`${baseURL}/discover`);
    const card = page.getByRole("link", { name: editedTitle });
    await expect(card).toBeVisible();
    await expect(card.locator("xpath=ancestor::article")).toContainText("Edited");
  } finally {
    await removePollFixture(sql, fixture);
    await sql.end();
  }
});
