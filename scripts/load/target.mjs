const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

/**
 * Parses a target URL without relying on the URL global, which k6 does not
 * provide. Returns the protocol and lowercase hostname, or null when the value
 * is not an absolute URL.
 */
export function parseTarget(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(value);
  if (!schemeMatch) return null;

  const protocol = `${schemeMatch[1].toLowerCase()}:`;
  let rest = value.slice(schemeMatch[0].length);

  const authorityEnd = rest.search(/[/?#]/);
  if (authorityEnd !== -1) rest = rest.slice(0, authorityEnd);

  const atIndex = rest.lastIndexOf("@");
  if (atIndex !== -1) rest = rest.slice(atIndex + 1);

  let hostname = rest;
  if (hostname.startsWith("[")) {
    const closing = hostname.indexOf("]");
    hostname = closing === -1 ? hostname : hostname.slice(0, closing + 1);
  } else {
    const colon = hostname.indexOf(":");
    if (colon !== -1) hostname = hostname.slice(0, colon);
  }

  if (!hostname) return null;
  return { protocol, hostname: hostname.toLowerCase() };
}

export function isLocalHost(hostname) {
  return LOCAL_HOSTS.includes(hostname);
}

/**
 * Resolves and validates the load-test target from an environment map.
 * Throws when the target is not allowed. Pure: no k6 globals are used, so the
 * same rules can be unit tested.
 */
export function resolveLoadTestTarget(env) {
  const baseUrl = env.BASE_URL;
  if (!baseUrl) {
    throw new Error("BASE_URL must be set to the target deployment or local server URL.");
  }

  const target = parseTarget(baseUrl);
  if (!target) {
    throw new Error("BASE_URL must be an absolute URL.");
  }

  const allowLocalhost = env.LOAD_TEST_ALLOW_LOCALHOST === "1";

  if (allowLocalhost) {
    if (!isLocalHost(target.hostname)) {
      throw new Error(
        "Refusing load test: LOAD_TEST_ALLOW_LOCALHOST=1 only allows localhost and 127.0.0.1.",
      );
    }
    if (target.protocol !== "http:") {
      throw new Error("Refusing load test: a local target must use http://.");
    }
  } else {
    if (target.protocol !== "https:") {
      throw new Error("BASE_URL must be the HTTPS URL of a Vercel preview deployment.");
    }
    const looksLikePreview =
      target.hostname.endsWith(".vercel.app") &&
      target.hostname.split(".")[0].split("-").length >= 3;
    if (!looksLikePreview) {
      throw new Error("Refusing load test: BASE_URL does not look like a Vercel preview host.");
    }
  }

  if (!env.LOAD_TEST_SECRET) throw new Error("LOAD_TEST_SECRET is required.");
  if (env.LOAD_TEST_CONFIRM !== "I_CONFIRM_PREVIEW_LOAD") {
    throw new Error("Set LOAD_TEST_CONFIRM=I_CONFIRM_PREVIEW_LOAD to confirm preview-only traffic.");
  }
  if (env.NEON_BRANCH_CONFIRM !== "I_CONFIRM_NEON_BRANCH") {
    throw new Error("Set NEON_BRANCH_CONFIRM=I_CONFIRM_NEON_BRANCH for a disposable Neon branch.");
  }
  if (!env.POLL_ID) throw new Error("POLL_ID is required.");

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    eventId: env.POLL_ID,
    secret: env.LOAD_TEST_SECRET,
    local: allowLocalhost,
    hostname: target.hostname,
  };
}
