const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

function isLocalHost(host) {
  return LOCAL_HOSTS.includes(host);
}

export function loadTestTarget() {
  const baseUrl = __ENV.BASE_URL;
  if (!baseUrl) {
    throw new Error("BASE_URL must be set to the target deployment or local server URL.");
  }

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("BASE_URL must be an absolute URL.");
  }

  const allowLocalhost = __ENV.LOAD_TEST_ALLOW_LOCALHOST === "1";
  const host = parsed.hostname.toLowerCase();

  if (allowLocalhost) {
    if (!isLocalHost(host)) {
      throw new Error(
        "Refusing load test: LOAD_TEST_ALLOW_LOCALHOST=1 only allows localhost and 127.0.0.1.",
      );
    }
    if (parsed.protocol !== "http:") {
      throw new Error("Refusing load test: a local target must use http://.");
    }
  } else {
    if (parsed.protocol !== "https:") {
      throw new Error("BASE_URL must be the HTTPS URL of a Vercel preview deployment.");
    }
    const looksLikePreview =
      host.endsWith(".vercel.app") && host.split(".")[0].split("-").length >= 3;
    if (!looksLikePreview) {
      throw new Error("Refusing load test: BASE_URL does not look like a Vercel preview host.");
    }
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
    local: allowLocalhost,
  };
}
