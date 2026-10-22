# Project context

A summary of what Pickem is, the decisions behind it, and where the work
stands. Written so a fresh session can pick up without re-deriving the history.

## Stack

- Next.js 16.3.5 (App Router, Turbopack), React 19.2.8, Tailwind CSS v4
- PostgreSQL on Neon, Drizzle ORM (`db/schema/app.ts`, `db/schema/auth.ts`)
- Better Auth 1.7.5 (Google OAuth + anonymous guest sessions)
- Upstash Redis (rate limits, results cache)
- Vitest 4 (unit + integration), Playwright 1.64 (end-to-end), k6 (load)
- `motion` 13.4 for result animations

## Domain model

Current production model: `events` → `options`, `votes` → `vote_picks`.
Quiz-builder direction: keep `events` as the quiz identity and add required
`questions`; questions own options and each question gets its own pick type.
`ballot_answers` will store selected options per question while `votes` remains
the quiz-level ballot/identity row.

| Concept | Where |
| --- | --- |
| Poll lifecycle | `draft` → `scheduled` → `open` → `closed` / `cancelled` |
| Visibility | `unlisted`, `discoverable`, `passcode` (a single exclusive enum) |
| Pick format | `single` (one option) or `top_n` (ranked picks, 2–8) |
| Voting window | `opens_at` / `closes_at`, evaluated against the **database clock** |
| Identity | a signed-in user, or a guest session token held in a cookie |

Ballots are immutable once submitted. Database triggers enforce that, plus the
option/event shape and the top-N rank limits (`drizzle/0004_ordered_ballot_integrity.sql`).

## Key decisions

**Database clock for the voting window.** `clock_timestamp()` from Postgres
decides whether voting is open, not the application server's clock. A ballot
that would land after the closing time is rolled back at the end of the
transaction. This removes clock skew between the app and the database as a
source of late votes.

**Shared lock for voters, exclusive lock for closing.** A ballot takes
`FOR KEY SHARE` on the poll row. `FOR KEY SHARE` (rather than `FOR SHARE`)
because the ballot transaction may itself update the poll row when a scheduled
poll opens, and `NO KEY UPDATE` conflicts with `FOR SHARE`. The owner's close
action takes `FOR UPDATE`, which conflicts with the shared lock, so a ballot
either commits before the close or is rejected. `tests/integration/concurrency.test.ts`
proves all three cases and fails if the lock mode is reverted.

**Versioned result snapshots.** A snapshot's version is the number of submitted
ballots. Submitted ballots are never deleted, so the version is monotonic and a
client can discard out-of-order responses. `hideSnapshotTallies` zeroes the
version for polls whose tallies are not visible yet.

**Caching follows the poll state.** Open polls: Redis cache with a 1 second
TTL, single-flighted so a burst of requests does not stampede the database.
Closed polls: 24 hour TTL. Public results are served with
`Cache-Control: public, s-maxage=1` while a poll is open and a long
`stale-while-revalidate` once it is closed; drafts and passcode polls are
`private, no-store`.

**Rate limits are best effort.** Upstash limits fail open: an outage must not
block a valid vote. Limits are identity-first (a voter, not an IP) so shared
IPs are not punished.

**Discovery is opt-in.** Only `discoverable` polls appear on the home page.
Because visibility is a single exclusive enum, a passcode poll can never appear
in that listing.

## What was built

- Poll creation wizard, drafts, publish, and discoverable home listing
- Guest and signed-in voting, single and ranked pick formats
- Owner controls: share link, close early, delete draft
- Public results endpoint with caching, rate limits and access guards
- Live results with polling, animated deltas and connection status
- Passcode-protected polls with an unlock gate
- Unit, integration and end-to-end test suites, CI, and load-test scenarios
- UTC/local date-time conversion for draft create/edit, with timezone regression
  coverage (`lib/events/date-time.ts`)
- Vercel Web Analytics in the root layout
- Responsive site navigation, `/discover`, and `/` as its current alias
- Profile/settings and account activity page (social link is intentionally not
  part of this change)

## Current state

The four recent changes (date/timezone, Analytics, navigation, profile/settings)
are pushed to `main`; GitHub CI run #9 for `8e017f3` is green. Do not repeat local
tests, Docker, database checks, or typecheck merely to re-verify those commits.
The current event model is still one question per event; quiz-builder work has
not started. See [`QUIZ_BUILDER_PLAN.md`](QUIZ_BUILDER_PLAN.md) for decisions,
migration outline, acceptance criteria, and ordered implementation tasks.

## Quiz-builder decisions (not implemented)

- Preserve `events` and `/events/<id>` as the quiz identity. A quiz has 1–20
  required questions, each with 2–8 options and its own Pick one or Pick top N
  (2–8); no quiz-wide pick type. Voter UI is one stacked page, answered count,
  and one atomic final submit. Reorder with up/down; duplicate; confirm delete.
- Persist times as UTC; render viewer-local time with timezone label/countdown;
  no timezone column. `/discover` is discovery; `/` remains its alias until a
  future static, no-database landing page.
- Quiz cover sources: app presets, server-only Unsplash search (`UNSPLASH_ACCESS_KEY`,
  Redis-cached; credit and download endpoint), or authenticated/rate-limited
  Vercel Blob upload with size/type limits, WebP resize, and EXIF removal.
  `cover_kind`, `cover_ref`, and `cover_meta` belong in migration 1.
- Title/description may change anytime; dates only before close. Never reopen;
  prohibit moving start into the future after ballots. Close/edit use event
  `FOR UPDATE`; voters use `FOR KEY SHARE`. Invalidate listing/results caches
  and show edited marker. Question types/options/picks lock after votes.
- Account deletion is last: anonymize PII, delete sessions/accounts/drafts,
  retain tombstone users for ballots, close or unlist open quizzes. Social link
  has a separate migration gate (platform + handle limited to HTTPS
  `instagram.com`/`x.com`).
- Migration 1 expands/backfills questions, question-owned options, ballot answers,
  and covers; deploy new code; migration 2 contracts legacy fields/tables.
  No compatibility validator. Autosave and per-question live snapshots use
  version gating; answer insertion is batched with constant statement count.
  Rehearse locally and ask before any database migration; Neon requires a backup
  branch first. Start with the reusable date/time picker commit on `main`, then
  feature-branch quiz work. See the plan for SQL and acceptance criteria.

## Known gaps and next steps

1. **Quiz builder.** Not started. First create the reusable date/time picker as
   a small commit on `main`; then use a feature branch for schema expand,
   autosaved drafts, covers, builder, multi-question voting/results, and edits.
   Keep migration 2 contract separate and ask before any migration. Full sequence
   and acceptance tests are in `docs/QUIZ_BUILDER_PLAN.md`.
2. **Pool sizing.** `DATABASE_POOL_MAX` defaults to 5 per instance. This has
   not been tuned against real traffic; measure before changing it.
3. **Vote throughput.** Ballots for one poll now run concurrently, but the
   local smoke still showed a long tail. Re-measure on a preview deployment.
4. **WebSockets.** Live updates poll every ~2 seconds. At 50,000 viewers that
   is 25,000 edge requests per second, which is a cost problem before it is a
   correctness problem. WebSockets are the intended next step.
5. **Scoring.** Ranked picks are collected but not scored; the rules are
   deliberately left undefined until results are known.

## Environment notes

- `DATABASE_URL` is the runtime URL (pooled in production);
  `DATABASE_URL_UNPOOLED` is the direct connection used for migrations.
- `DATABASE_POOL_MAX` defaults to 5; `db/index.ts` sets `prepare: false` for the
  Neon transaction pooler.
- Better Auth uses the configured static `BETTER_AUTH_URL`; trusted origins are
  configured with `BETTER_AUTH_TRUSTED_ORIGINS` (production URL only in
  production).
- `DATABASE_URL_TEST` must point at a disposable branch. The test suites refuse
  to run when the target host matches any known production host.
