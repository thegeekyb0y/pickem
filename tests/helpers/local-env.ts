import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

/**
 * Loads local environment values without printing them. Existing process
 * environment variables always win, so CI and shell-provided values are kept.
 */
export function loadLocalEnv(): void {
  loadEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true, override: false });
}

/**
 * Returns the disposable branch database URL, preferring the process
 * environment and falling back to .env.local. The value is never logged.
 */
export function resolveTestDatabaseUrl(): string | undefined {
  loadLocalEnv();
  return process.env.DATABASE_URL_TEST?.trim() || undefined;
}

/**
 * Points the application runtime at the disposable branch. Both variables are
 * set because the runtime uses the pooled URL and migrations use the direct
 * one, and .env.local points those at production. Call this before the
 * application modules are imported.
 */
export function applyTestDatabaseUrl(url: string): void {
  process.env.DATABASE_URL = url;
  process.env.DATABASE_URL_UNPOOLED = url;
}

/**
 * Fails closed in CI: a green build must not come from skipping the database
 * suites. Locally the suites may still skip when no disposable database is
 * configured.
 */
export function assertDatabaseSuitesEnabled(label: string): void {
  if (process.env.CI !== "true") return;
  if (process.env.ALLOW_TEST_DB_MUTATION === "1" && resolveTestDatabaseUrl()) return;
  throw new Error(
    `CI is running ${label}, but the database suites are disabled. ` +
      "Set DATABASE_URL_TEST and ALLOW_TEST_DB_MUTATION=1.",
  );
}
