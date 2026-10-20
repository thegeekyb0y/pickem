import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const canRunAgainstTestBranch =
  process.env.ALLOW_TEST_DB_MUTATION === "1" && Boolean(process.env.DATABASE_URL_TEST);
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
  timeout: 30_000,
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
          DATABASE_URL: process.env.DATABASE_URL_TEST!,
          BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "pickem-e2e-test-secret",
          BETTER_AUTH_URL: baseURL,
        },
      }
    : undefined,
});
