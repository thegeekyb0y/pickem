/**
 * Pre-flight check for the build-time migration.
 *
 * Preview deployments run migrations during the build. Without Neon preview
 * branching, the preview database is the production database, so this refuses
 * to migrate when the target is a known production host.
 *
 * The comparison uses hostnames only and never prints a connection string.
 *
 * Set PRODUCTION_DATABASE_HOST (hostname only, no credentials) to make this
 * check meaningful. When it is not set, the check warns and allows the
 * migration.
 */

import { hostnameOf, resolveProductionDatabaseHosts } from "../db-guard.mjs";

const target = hostnameOf(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
const productionHosts = resolveProductionDatabaseHosts();

if (!target) {
  console.error(
    "Refusing to migrate: no database URL is configured (DATABASE_URL_UNPOOLED or DATABASE_URL).",
  );
  process.exit(1);
}

if (productionHosts.has(target)) {
  console.error(
    "Refusing to migrate: the target database host matches the production database host. " +
      "Enable Neon preview branching, or run migrations manually against the production branch.",
  );
  process.exit(1);
}

if (productionHosts.size === 0) {
  console.warn(
    "Migrating without a known production host to compare against. " +
      "Set PRODUCTION_DATABASE_HOST to make this check meaningful.",
  );
}

console.log("Pre-flight passed: the migration target is not the production database.");
