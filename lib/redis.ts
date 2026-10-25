import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  // Redis is an optimization: rate limits fail open and the results cache
  // falls back to the database. The default client retries network errors for
  // ~4.4s per command, which stacks up to tens of seconds on a dead endpoint
  // and makes a results poll look hung. Fail fast so callers reach the
  // database instead.
  retry: false,
});
