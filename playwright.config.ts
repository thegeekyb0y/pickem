import { defineConfig, devices } from "@playwright/test";
import { loadLocalEnv } from "./tests/helpers/local-env";

// Read local values (DATABASE_URL_TEST) without printing them. Process
// environment variables always win.
loadLocalEnv();

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const canRunAgainstTestBranch =
  process.env.ALLOW_TEST_DB_MUTATION === "1" && Boolean(process.env.DATABASE_URL_TEST);
if (process.env.CI === "true" && !canRunAgainstTestBranch) {
  throw new Error(
    "CI is running Playwright without DATABASE_URL_TEST and ALLOW_TEST_DB_MUTATION=1; " +
      "the end-to-end suite would be skipped.",
  );
}
const useLocalServer = !process.env.BASE_URL && canRunAgainstTestBranch;
if (process.env.BASE_URL) {
  const hostname = new URL(process.env.BASE_URL).hostname;
  const looksLikeVercelPreview =
    hostname.endsWith(".vercel.app") && hostname.split(".")[0].split("-").length >= 3;
  if (!looksLikeVercelPreview) {
    throw new Error("Playwright must target a Vercel preview URL, never a production domain.");
  }
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Generous: a dev server compiles server actions on first use.
  timeout: 90_000,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    // Use an already-installed browser when requested; CI keeps bundled Chromium.
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
      },
    },
  ],
  webServer: useLocalServer
    ? {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          // Both variables are set: the runtime uses the pooled URL and
          // migrations use the direct one, so leaving them alone would point
          // the dev server at production.
          DATABASE_URL: process.env.DATABASE_URL_TEST!,
          DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_TEST!,
          BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "pickem-e2e-test-secret",
          BETTER_AUTH_URL: baseURL,
        },
      }
    : undefined,
});
