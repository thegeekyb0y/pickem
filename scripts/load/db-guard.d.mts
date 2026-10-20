export function readDotEnvValue(name: string): string | undefined;

export type GuardEnv = Record<string, string | undefined>;

export function hostnameOf(connectionString: string | undefined | null): string | null;

export function resolveProductionDatabaseHost(env?: GuardEnv): string | null;

export function resolveProductionDatabaseHosts(env?: GuardEnv): Set<string>;

export function resolveTargetDatabaseHost(
  env?: GuardEnv,
  options?: { allowRuntimeFallback?: boolean },
): string | null;

export function assertNotProductionDatabase(options: {
  label?: string;
  targetHost: string | null;
  productionHost?: string | null;
  productionHosts?: Set<string>;
}): true;

export function guardAgainstProductionDatabase(options?: {
  label?: string;
  env?: GuardEnv;
  allowRuntimeFallback?: boolean;
}): true;
