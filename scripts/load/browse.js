import http from "k6/http";
import { check, sleep } from "k6";
import { loadTestTarget } from "./config.js";

const target = loadTestTarget();
const vus = Number(__ENV.VUS || 200);

export const options = {
  stages: [
    { duration: "30s", target: Math.ceil(vus / 2) },
    { duration: "60s", target: vus },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.005"],
    http_req_duration: ["p(95)<1200"],
  },
};

export default function browseScenario() {
  const home = http.get(`${target.baseUrl}/`, { tags: { endpoint: "home" } });
  check(home, { "home returns 200": (response) => response.status === 200 });

  const event = http.get(`${target.baseUrl}/events/${target.eventId}`, {
    tags: { endpoint: "event-page" },
  });
  check(event, { "event page returns 200": (response) => response.status === 200 });
  sleep(Math.random() * 2);
}
