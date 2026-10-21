import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Pre-flight guard shared by the integration/E2E suites and the load-test seed
 * script. It refuses to run when the target database host is the production
 * database host. Hostnames are compared only; connection strings are never
 * logged and .env.local is never printed.
 */

const LOCAL_ENV_PATH = resolve(process.cwd(), ".env.local");

export function readDotEnvValue(name) {
  let contents;
  try {
    contents = readFileSync(LOCAL_ENV_PATH, "utf8");
  } catch {
    return undefined;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (key !== name) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }

  return undefined;
}

function firstDefined(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

/**
 * Returns a comparable hostname for a connection string or bare hostname.
 * Credentials, paths, query strings and ports are discarded.
 */
export function hostnameOf(connectionString) {
  const value = connectionString?.trim();
  if (!value) return null;

  try {
    return new URL(value).hostname.toLowerCase() || null;
  } catch {
    // Not a URL: treat the value as a bare hostname.
    const withoutCredentials = value.split("@").pop() ?? value;
    const host = withoutCredentials.split("/")[0].split(":")[0];
    return host.trim() ? host.trim().toLowerCase() : null;
  }
}

/**
 * Resolves the production database host from, in order:
 * PRODUCTION_DATABASE_HOST, PRODUCTION_DATABASE_URL, DATABASE_URL, then .env.local.
 * Returns null when it cannot be determined.
 */
export function resolveProductionDatabaseHost(env = process.env) {
  const explicitHost = firstDefined(env.PRODUCTION_DATABASE_HOST);
  if (explicitHost) return hostnameOf(explicitHost);

  const explicitUrl = firstDefined(env.PRODUCTION_DATABASE_URL);
  if (explicitUrl) return hostnameOf(explicitUrl);

  const runtimeUrl = firstDefined(env.DATABASE_URL);
  if (runtimeUrl) return hostnameOf(runtimeUrl);

  const fileUrl = firstDefined(readDotEnvValue("DATABASE_URL"));
  if (fileUrl) return hostnameOf(fileUrl);

  return null;
}

/**
 * Every hostname that identifies the production database. Neon exposes the
 * same database under two hostnames: the pooled one (DATABASE_URL) and the
 * direct one (DATABASE_URL_UNPOOLED). Both are compared, because a branch
 * URL that matches only one of them is still the production database.
 */
export function resolveProductionDatabaseHosts(env = process.env) {
  const hosts = new Set();

  const add = (value) => {
    const host = hostnameOf(value);
    if (host) hosts.add(host);
  };

  add(env.PRODUCTION_DATABASE_HOST);
  add(env.PRODUCTION_DATABASE_URL);
  add(env.DATABASE_URL);
  add(env.DATABASE_URL_UNPOOLED);
  add(readDotEnvValue("DATABASE_URL"));
  add(readDotEnvValue("DATABASE_URL_UNPOOLED"));

  return hosts;
}

/**
 * Resolves the target (test) database host from DATABASE_URL_TEST, falling back
 * to DATABASE_URL only when the caller explicitly allows it.
 */
export function resolveTargetDatabaseHost(env = process.env, { allowRuntimeFallback = false } = {}) {
  const testUrl = firstDefined(env.DATABASE_URL_TEST);
  if (testUrl) return hostnameOf(testUrl);

  if (allowRuntimeFallback) {
    const runtimeUrl = firstDefined(env.DATABASE_URL);
    if (runtimeUrl) return hostnameOf(runtimeUrl);
  }

  const fileUrl = firstDefined(readDotEnvValue("DATABASE_URL_TEST"));
  if (fileUrl) return hostnameOf(fileUrl);

  return null;
}

/**
 * Throws when the target database host is one of the production database
 * hosts, or when the production host cannot be determined (fail closed).
 * Messages never include a hostname or a connection string.
 */
export function assertNotProductionDatabase({
  label = "test run",
  targetHost,
  productionHost,
  productionHosts,
}) {
  if (!targetHost) {
    throw new Error(
      `Refusing to run ${label}: no target database host could be determined. ` +
        "Set DATABASE_URL_TEST to a disposable branch URL.",
    );
  }

  const known = new Set(productionHosts ?? []);
  if (productionHost) known.add(productionHost);

  if (known.size === 0) {
    throw new Error(
      `Refusing to run ${label}: the production database host is unknown. ` +
        "Set PRODUCTION_DATABASE_HOST (or PRODUCTION_DATABASE_URL) so the guard can compare hosts.",
    );
  }

  if (known.has(targetHost)) {
    throw new Error(
      `Refusing to run ${label}: the target database host matches the production database host. ` +
        "Use a disposable branch with a different host.",
    );
  }

  return true;
}

/**
 * Convenience wrapper that resolves both hosts and runs the comparison.
 */
export function guardAgainstProductionDatabase({
  label = "test run",
  env = process.env,
  allowRuntimeFallback = false,
} = {}) {
  const targetHost = resolveTargetDatabaseHost(env, { allowRuntimeFallback });
  const productionHosts = resolveProductionDatabaseHosts(env);
  return assertNotProductionDatabase({
    label,
    targetHost,
    productionHost: resolveProductionDatabaseHost(env),
    productionHosts,
  });
}
