export function loadTestTarget() {
  const baseUrl = __ENV.BASE_URL;
  if (!baseUrl || !baseUrl.startsWith("https://")) {
    throw new Error("BASE_URL must be the HTTPS URL of a Vercel preview deployment.");
  }
  const host = new URL(baseUrl).hostname;
  const looksLikePreview = host.endsWith(".vercel.app") && host.split(".")[0].split("-").length >= 3;
  if (!looksLikePreview) {
    throw new Error("Refusing load test: BASE_URL does not look like a Vercel preview host.");
  }
  if (!__ENV.LOAD_TEST_SECRET) throw new Error("LOAD_TEST_SECRET is required.");
  if (__ENV.LOAD_TEST_CONFIRM !== "I_CONFIRM_PREVIEW_LOAD") {
    throw new Error("Set LOAD_TEST_CONFIRM=I_CONFIRM_PREVIEW_LOAD to confirm preview-only traffic.");
  }
  if (__ENV.NEON_BRANCH_CONFIRM !== "I_CONFIRM_NEON_BRANCH") {
    throw new Error("Set NEON_BRANCH_CONFIRM=I_CONFIRM_NEON_BRANCH for a disposable Neon branch.");
  }
  if (!__ENV.POLL_ID) throw new Error("POLL_ID is required.");

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    eventId: __ENV.POLL_ID,
    secret: __ENV.LOAD_TEST_SECRET,
  };
}
