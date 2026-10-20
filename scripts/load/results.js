import http from "k6/http";
import { check, sleep } from "k6";
import { loadTestTarget } from "./config.js";

const target = loadTestTarget();
const vus = Number(__ENV.VUS || 2_000);

export const options = {
  vus,
  duration: __ENV.DURATION || "2m",
  thresholds: {
    http_req_failed: ["rate<0.005"],
    "http_req_duration{endpoint:results}": ["p(95)<300"],
  },
};

export default function resultsScenario() {
  const response = http.get(`${target.baseUrl}/api/events/${target.eventId}/results`, {
    // The route only accepts client ids of 12 characters or more, so this
    // models one browser session per virtual user.
    headers: { "x-client-id": `k6-session-${__VU}-000000` },
    tags: { endpoint: "results" },
  });
  check(response, {
    "results returns 200": (result) => result.status === 200,
    "results has a version": (result) => Boolean(result.json("version") !== undefined),
  });
  sleep(1.6 + Math.random() * 0.8);
}
