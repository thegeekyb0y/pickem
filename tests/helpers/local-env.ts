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
