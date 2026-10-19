# Preview load tests

These k6 scenarios are intentionally guarded. Run them only against a Vercel preview deployment whose `DATABASE_URL` points to a disposable Neon branch. The write scenario uses `/api/load/vote`, which is unavailable unless `VERCEL_ENV=preview` and `ENABLE_LOAD_TEST_ROUTES=1`; it also requires a secret header. Never set that flag or secret on production.

## Capacity assumptions

- 50,000 unique voters; 1.5 page loads each over an hour: about 21 page loads/s average, with a modeled 300–350/s one-minute burst.
- 10,000 simultaneous viewers polling every 2 seconds: 5,000 edge requests/s. At 50,000 viewers: 25,000 edge requests/s. With `s-maxage=1`, origin reads should be roughly 1–5/s per region; CDN traffic and cost remain the reason to move to WebSockets at the 50k stage.
- 50,000 ballots over one hour: 14/s average. Model 400–600/s during the final minute and test a 1,000/s burst only after provisioned Neon capacity and trigger behavior are reviewed.
- An event-page request currently needs roughly 8–9 DB queries; a single ballot has 5–8 writes plus validation-trigger reads. At 1,000 ballots/s, the existing row-level trigger lookups can dominate DB load. The cache and pooled connection settings help reads/connections; they do not replace measuring trigger CPU/lock waits.

## Stages and thresholds

| Stage | Target | Pass criteria |
| --- | --- | --- |
| 2k | `browse.js` at 2,000 VUs and results at 2,000 VUs | home p95 < 800ms, event p95 < 800ms, results p95 < 300ms, failures < 0.5% |
| 10k | results at 10,000 VUs; vote spike 100–200/s | results p95 < 500ms, vote p95 < 800ms, failures < 0.5% |
| 50k | results at 50,000 VUs, then WS test after transport is chosen | polling fan-out is a cost/edge target, not the intended final transport; WS delivery p95 < 2s, vote p95 < 1s, failures < 1% |
| Deadline | vote spike 1,000/s for 60s, after DB/trigger review | vote p95 < 1s, failures < 1%, zero successful submissions after close |

At 50k concurrent viewers, two-second polling is 25k HTTP requests/s at the edge even when the CDN collapses origin work. Treat that as a deliberate stress run, not a routine preview check.

## Commands

Install k6 separately, then set `BASE_URL` to a deployment URL such as `https://pickem-git-live-results-team.vercel.app`. The hostname guard requires a Vercel preview-shaped host. Every command also requires:

- `LOAD_TEST_SECRET` — matches the preview's `LOAD_TEST_SECRET`.
- `LOAD_TEST_CONFIRM=I_CONFIRM_PREVIEW_LOAD`.
- `NEON_BRANCH_CONFIRM=I_CONFIRM_NEON_BRANCH`.
- `POLL_ID` — an open test poll in the preview's Neon branch.

```sh
k6 run -e BASE_URL=https://pickem-git-live-results-team.vercel.app \
  -e POLL_ID=<event-uuid> -e LOAD_TEST_SECRET=<preview-secret> \
  -e LOAD_TEST_CONFIRM=I_CONFIRM_PREVIEW_LOAD \
  -e NEON_BRANCH_CONFIRM=I_CONFIRM_NEON_BRANCH scripts/load/browse.js
```

```sh
k6 run -e BASE_URL=https://pickem-git-live-results-team.vercel.app \
  -e POLL_ID=<event-uuid> -e VUS=10000 -e DURATION=2m \
  -e LOAD_TEST_SECRET=<preview-secret> \
  -e LOAD_TEST_CONFIRM=I_CONFIRM_PREVIEW_LOAD \
  -e NEON_BRANCH_CONFIRM=I_CONFIRM_NEON_BRANCH scripts/load/results.js
```

```sh
k6 run -e BASE_URL=https://pickem-git-live-results-team.vercel.app \
  -e POLL_ID=<event-uuid> -e OPTION_ID=<option-uuid> \
  -e VOTES_PER_SECOND=100 -e DURATION=60s \
  -e LOAD_TEST_SECRET=<preview-secret> \
  -e LOAD_TEST_CONFIRM=I_CONFIRM_PREVIEW_LOAD \
  -e NEON_BRANCH_CONFIRM=I_CONFIRM_NEON_BRANCH scripts/load/vote-spike.js
```

The write test creates unique guest tokens per iteration and invokes the same `submitVote` action and DB triggers as the app. Seed/reset its poll on the Neon branch between runs. Never run it against production.

## Observe and verify

Capture k6 p95/error rate, Vercel edge cache `HIT` ratio, function duration/invocations, Neon CU/CPU/connection/lock-wait metrics, Upstash commands, and rate-limit 429s. A successful latency run is not sufficient if the Neon branch is CPU-saturated or the Redis budget is exceeded.

Verify query plans on the branch with `EXPLAIN (ANALYZE, BUFFERS)` for event listing counts, `votes(event_id)`, `options(event_id)`, and `vote_picks(event_id, option_id, rank_position)`. Small tables may correctly use sequential scans; verify index existence and repeat after seeding a representative ballot volume.

## Launch configuration checks

- Google OAuth consent screen is in production, authorized domains and callback URLs cover the production domain and preview domain policy.
- Vercel plan covers function invocations, bandwidth, edge requests, preview deployments, region placement, and budget alerts.
- Neon runtime uses the pooled `-pooler` URL; Drizzle migrations use `DATABASE_URL_DIRECT`; size autoscaling/connection caps for the tested stage.
- Upstash plan covers rate-limit commands, cache reads/writes, and budget alerts. The result route's cache and client-ID limit are not a substitute for a high-capacity plan.
- Vote limits are identity-first with a deliberately high IP ceiling so NAT/shared-IP voters are not punished. Configure Vercel WAF limits separately for abusive traffic.
- Confirm preview `ENABLE_LOAD_TEST_ROUTES=1` and `LOAD_TEST_SECRET` are unset on production. Never log passcodes, cookies, tokens, load secrets, or raw IPs.
