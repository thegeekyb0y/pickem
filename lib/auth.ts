import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { db } from "@/db";
import * as authSchema from "@/db/schema/auth";
import { resolveTrustedOrigins } from "@/lib/auth-origins";

/**
 * The public origin of this deployment. Set it to the production URL in
 * Production; previews get their own preview URL.
 */
const baseURL = process.env.BETTER_AUTH_URL!;

export const auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET!,
  // Origins allowed to make state-changing requests. Defaults to the
  // deployment's own origin; set BETTER_AUTH_TRUSTED_ORIGINS to the
  // production URL only, so Google sign-in stays limited to the production
  // domain and preview deployments refuse sign-in instead of failing later at
  // the OAuth redirect.
  trustedOrigins: resolveTrustedOrigins(),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 300,
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
});
