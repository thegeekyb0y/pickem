import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Runtime connection.
 *
 * The app always talks to Neon through the transaction pooler. The pooler
 * multiplexes many client connections over a small number of Neon backend
 * connections, which is what keeps a horizontally scaled serverless deployment
 * from exhausting the database's connection budget.
 *
 * These are the variable names the Neon Vercel integration provides:
 * DATABASE_URL is the pooled URL and DATABASE_URL_UNPOOLED is the direct one.
 * Migrations must use a direct connection; see drizzle.config.ts.
 */
const connectionUrl = process.env.DATABASE_URL!;

const client = postgres(connectionUrl, {
  // Neon transaction-pooler URLs require prepared statements to be disabled.
  prepare: false,
  // Names the connection so it can be identified in pg_stat_activity.
  connection: { application_name: "pickem" },
  // Small per instance: serverless instances scale horizontally, so the total
  // client connection count is instances x max. A low value keeps that within
  // the pooler's budget while still allowing a request to run more than one
  // database round trip at a time.
  max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
