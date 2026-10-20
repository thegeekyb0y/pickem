/**
 * Guard-only probe for the load-test target rules. It sends no traffic and
 * touches no database: it only checks which targets are allowed or refused.
 *
 * Usage: node scripts/load/guard-check.js
 */

import { resolveLoadTestTarget } from "./target.mjs";

const BASE_ENV = {
  LOAD_TEST_SECRET: "probe-secret",
  LOAD_TEST_CONFIRM: "I_CONFIRM_PREVIEW_LOAD",
  NEON_BRANCH_CONFIRM: "I_CONFIRM_NEON_BRANCH",
  POLL_ID: "00000000-0000-4000-8000-000000000001",
};

const cases = [
  {
    label: "localhost with the local flag",
    env: { ...BASE_ENV, BASE_URL: "http://localhost:3000", LOAD_TEST_ALLOW_LOCALHOST: "1" },
    expect: "allowed",
  },
  {
    label: "127.0.0.1 with the local flag",
    env: { ...BASE_ENV, BASE_URL: "http://127.0.0.1:3000", LOAD_TEST_ALLOW_LOCALHOST: "1" },
    expect: "allowed",
  },
  {
    label: "127.0.0.2 with the local flag",
    env: { ...BASE_ENV, BASE_URL: "http://127.0.0.2:3000", LOAD_TEST_ALLOW_LOCALHOST: "1" },
    expect: "refused",
  },
  {
    label: "localhost with https and the local flag",
    env: { ...BASE_ENV, BASE_URL: "https://localhost:3000", LOAD_TEST_ALLOW_LOCALHOST: "1" },
    expect: "refused",
  },
  {
    label: "localhost without the local flag",
    env: { ...BASE_ENV, BASE_URL: "http://localhost:3000" },
    expect: "refused",
  },
  {
    label: "a production host with the local flag",
    env: { ...BASE_ENV, BASE_URL: "https://pickem.vercel.app", LOAD_TEST_ALLOW_LOCALHOST: "1" },
    expect: "refused",
  },
  {
    label: "a production host without the local flag",
    env: { ...BASE_ENV, BASE_URL: "https://pickem.vercel.app" },
    expect: "refused",
  },
  {
    label: "a preview host without the local flag",
    env: { ...BASE_ENV, BASE_URL: "https://pickem-git-feature-team.vercel.app" },
    expect: "allowed",
  },
  {
    label: "a preview host without LOAD_TEST_CONFIRM",
    env: { ...BASE_ENV, BASE_URL: "https://pickem-git-feature-team.vercel.app", LOAD_TEST_CONFIRM: "" },
    expect: "refused",
  },
  {
    label: "a preview host without LOAD_TEST_SECRET",
    env: { ...BASE_ENV, BASE_URL: "https://pickem-git-feature-team.vercel.app", LOAD_TEST_SECRET: "" },
    expect: "refused",
  },
  {
    label: "a preview host without NEON_BRANCH_CONFIRM",
    env: {
      ...BASE_ENV,
      BASE_URL: "https://pickem-git-feature-team.vercel.app",
      NEON_BRANCH_CONFIRM: "",
    },
    expect: "refused",
  },
  {
    label: "a preview host without POLL_ID",
    env: { ...BASE_ENV, BASE_URL: "https://pickem-git-feature-team.vercel.app", POLL_ID: "" },
    expect: "refused",
  },
  {
    label: "a value that is not a URL",
    env: { ...BASE_ENV, BASE_URL: "not-a-url" },
    expect: "refused",
  },
];

let failures = 0;

for (const testCase of cases) {
  let outcome = "allowed";
  let reason = "";
  try {
    resolveLoadTestTarget(testCase.env);
  } catch (error) {
    outcome = "refused";
    reason = error instanceof Error ? error.message : String(error);
  }

  const ok = outcome === testCase.expect;
  if (!ok) failures += 1;
  const status = ok ? "PASS" : "FAIL";
  const detail = outcome === "refused" ? ` (${reason})` : "";
  console.log(`${status}  ${testCase.label} -> ${outcome}${detail}`);
}

if (failures > 0) {
  console.error(`\n${failures} guard case(s) did not behave as expected.`);
  process.exit(1);
}

console.log(`\nAll ${cases.length} guard cases behaved as expected.`);
