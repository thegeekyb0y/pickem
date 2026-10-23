import http from "k6/http";
import { check } from "k6";
import { loadTestTarget } from "./config.js";

const target = loadTestTarget();
const rate = Number(__ENV.VOTES_PER_SECOND || 100);
const duration = __ENV.DURATION || "60s";
if (!__ENV.ANSWERS_JSON) throw new Error("ANSWERS_JSON is required for the ballot load test.");
let answers;
try {
  answers = JSON.parse(__ENV.ANSWERS_JSON);
} catch {
  throw new Error("ANSWERS_JSON must be a valid quiz answer array.");
}
if (!Array.isArray(answers) || answers.length < 1 || answers.length > 20) {
  throw new Error("ANSWERS_JSON must contain answers for 1 to 20 questions.");
}

export const options = {
  scenarios: {
    deadline_spike: {
      executor: "constant-arrival-rate",
      rate,
      timeUnit: "1s",
      duration,
      preAllocatedVUs: Math.max(100, rate),
      maxVUs: Math.max(500, rate * 4),
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000"],
  },
};

export default function voteSpikeScenario() {
  const uniqueToken = `load-${__VU}-${__ITER}-${Date.now()}`;
  const response = http.post(
    `${target.baseUrl}/api/load/vote`,
    JSON.stringify({ eventId: target.eventId, answers }),
    {
      headers: {
        "Content-Type": "application/json",
        "x-load-test-secret": target.secret,
        Cookie: `pickem_guest_session=${uniqueToken}`,
      },
      tags: { endpoint: "vote" },
    },
  );
  check(response, {
    "ballot accepted": (result) => result.status === 201,
  });
}
