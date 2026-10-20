import { resolveLoadTestTarget } from "./target.mjs";

/**
 * k6 entry point for the load scenarios. The rules live in target.js so the
 * same guard can be unit tested and probed without sending any traffic.
 */
export function loadTestTarget() {
  return resolveLoadTestTarget(__ENV);
}
