/**
 * Origins allowed to make state-changing requests to the auth API (sign in,
 * sign out, link a provider).
 *
 * The deployment's own origin is allowed by default. Set
 * BETTER_AUTH_TRUSTED_ORIGINS to a comma-separated list to restrict it, for
 * example to the production URL only, so that Google sign-in stays limited to
 * the production domain and preview deployments refuse sign-in instead of
 * failing later at the OAuth redirect.
 */
export function resolveTrustedOrigins(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const configured = env.BETTER_AUTH_TRUSTED_ORIGINS ?? env.BETTER_AUTH_URL ?? "";
  return configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
