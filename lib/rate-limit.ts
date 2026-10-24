import { createHmac } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "@/lib/redis";

const ephemeralCache = new Map<string, number>();
const ipVoteLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100_000, "1 m"),
  prefix: "pickem:rate:vote-ip",
  ephemeralCache,
  analytics: false,
  timeout: 750,
});
const identityVoteLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
  prefix: "pickem:rate:vote-identity",
  ephemeralCache,
  analytics: false,
  timeout: 750,
});
const passcodeIpLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(1_000, "10 m"),
  prefix: "pickem:rate:passcode-ip",
  ephemeralCache,
  analytics: false,
  timeout: 750,
});
const passcodeEventLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100_000, "10 m"),
  prefix: "pickem:rate:passcode-event",
  ephemeralCache,
  analytics: false,
  timeout: 750,
});
const resultsClientLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "10 s"),
  prefix: "pickem:rate:results-client",
  ephemeralCache,
  analytics: false,
  timeout: 750,
});
const resultsIpLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(50_000, "10 s"),
  prefix: "pickem:rate:results-ip",
  ephemeralCache,
  analytics: false,
  timeout: 750,
});
const unsplashSearchLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1 h"),
  prefix: "pickem:rate:unsplash-search",
  ephemeralCache,
  analytics: false,
  timeout: 750,
});
const unsplashApiLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(45, "1 h"),
  prefix: "pickem:rate:unsplash-api-global",
  ephemeralCache,
  analytics: false,
  timeout: 750,
});
const quizCoverUploadLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(12, "1 h"),
  prefix: "pickem:rate:quiz-cover-upload",
  ephemeralCache,
  analytics: false,
  timeout: 750,
});
const slugAvailabilityLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(40, "1 m"),
  prefix: "pickem:rate:slug-availability",
  ephemeralCache,
  analytics: false,
  timeout: 750,
});

function digest(value: string) {
  const secret = process.env.RATE_LIMIT_HASH_SECRET ?? process.env.BETTER_AUTH_SECRET ?? "pickem-development";
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function getClientIp(requestHeaders: Headers): string {
  const realIp = requestHeaders.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

async function allowed(limiter: Ratelimit, key: string): Promise<boolean> {
  try {
    return (await limiter.limit(digest(key))).success;
  } catch {
    // Rate limiting is best-effort; outages must not prevent a valid vote.
    return true;
  }
}

export async function limitPasscodeAttempt(ip: string, eventId: string) {
  const [ipAllowed, eventAllowed] = await Promise.all([
    allowed(passcodeIpLimiter, `${ip}:${eventId}`),
    allowed(passcodeEventLimiter, eventId),
  ]);
  return ipAllowed && eventAllowed;
}

export async function limitVoteByIp(ip: string) {
  return allowed(ipVoteLimiter, ip);
}

export async function limitVoteByIdentity(identity: string, eventId: string) {
  return allowed(identityVoteLimiter, `${identity}:${eventId}`);
}

export async function limitResultsRequest(ip: string, clientId: string, eventId: string) {
  const [clientAllowed, ipAllowed] = await Promise.all([
    allowed(resultsClientLimiter, `${clientId}:${eventId}`),
    allowed(resultsIpLimiter, `${ip}:${eventId}`),
  ]);
  return clientAllowed && ipAllowed;
}

export async function limitUnsplashSearch(userId: string) {
  return allowed(unsplashSearchLimiter, userId);
}

export async function limitUnsplashApiRequest() {
  return allowed(unsplashApiLimiter, "global");
}

export async function limitQuizCoverUpload(userId: string) {
  return allowed(quizCoverUploadLimiter, userId);
}

export async function limitSlugAvailability(userId: string) {
  return allowed(slugAvailabilityLimiter, userId);
}
