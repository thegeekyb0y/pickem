export type LoadTestTarget = {
  baseUrl: string;
  eventId: string;
  secret: string;
  local: boolean;
  hostname: string;
};

export type LoadTestEnv = Record<string, string | undefined>;

export function parseTarget(rawUrl: string | undefined | null): {
  protocol: string;
  hostname: string;
} | null;

export function isLocalHost(hostname: string): boolean;

export function resolveLoadTestTarget(env: LoadTestEnv): LoadTestTarget;
