# Project context

A summary of what Pickem is, the decisions behind it, and where the work
stands. Written so a fresh session can pick up without re-deriving the history.

Last updated: 2026-10-25.

## Stack

- Next.js 16.3.5 (App Router, Turbopack), React 19.2.8, Tailwind CSS v4
- PostgreSQL on Neon, Drizzle ORM (`db/schema/app.ts`, `db/schema/auth.ts`)
- Better Auth 1.7.5 (Google OAuth + anonymous guest sessions)
- Upstash Redis (rate limits, results cache)
- Vitest 4 (unit + integration), Playwright 1.64 (end-to-end), k6 (load)
- `motion` 13.4, `react-day-picker` 10, `date-fns`, `sharp`, `@vercel/blob`
- Fluid Functionalism components (Radix flavor) in `components/ui/*`
- Bricolage Grotesque + Geist Mono; Inter Variable is scoped to Fluid controls
  through `app/fluid-font.ts` with `preload: false`
- `cn` lives in `lib/cn.ts`; `lib/utils.ts` only re-exports it

## Current repository state

- `origin/main` is `6921175 docs: record share slugs and image controls`.
  PRs #1–#6 are merged, so `main` contains the multi-question builder, Phase 1
  reliability fixes, poll polish phases 1–5, share slugs, and image controls.
- Local `main` is three commits ahead of `origin/main` and has not been pushed:
  `c63b369 fix(events): write updated_at from the database clock`,
  `fe346e5 fix(db): validate option changes on published quizzes`, and
  `464e733 ci: run database suites against a Postgres service`. Task D (slug
  tests plus this doc update) is the next local commit.
- Production tracks `origin/main`. Nothing from these four local commits is
  deployed, and no migration has been applied to production since `0008`.
- Migration state:
  - `0000`–`0008` are applied to Neon production.
  - `0009_fix_option_publish_validation.sql` replaces only
    `validate_published_quiz_questions()`. It is reviewed and rehearsed but
    **not applied to production**; the owner will apply it.
  - The contract migration is renumbered to `0010`. It must not be authored
    with `drizzle-kit generate` until the snapshot chain is rebuilt (see
    “Migration snapshots” below).
- Safety branches still exist: `backup/wip-quiz-builder` (`f3abaa6`) and
  `backup/pre-split-37cc032` (`37cc032`). Local
  `feature/fluid-quiz-builder` (`cf101c5`) is fully contained in
  `origin/main`.
- CI was previously green only because the database suites were skipped: the
  `NEON_TEST_DATABASE_URL` secret was unset, so migrate and integration
  “succeeded” in 0 s with every test skipped, and the browser/e2e steps were
  skipped too. Run `40104587319` on `6921175` is that false green.
- CI now starts a disposable `postgres:17-alpine` service container and uses
  no Neon secrets. The new workflow has not run on GitHub yet because nothing
  has been pushed.
- Local test container `pickem-test-pg` runs on `127.0.0.1:55432`. The base
  test database, `pickem_fresh_0009` (fresh `0000`–`0009`), and
  `pickem_fresh_0008` (fresh `0000`–`0008`, then upgraded to `0009`) are all
  at migration `0009` with 10 recorded migrations. Integration and e2e suites
  point at the base database through `DATABASE_URL_TEST`.

## Migration snapshots

Drizzle stores a JSON snapshot per generated migration in `drizzle/meta/`.
Snapshots exist only through `0004_snapshot.json`; **`0005` through `0009` have
no snapshot**. Migrations `0005`–`0009` were authored by hand (`--custom`) or
edited after generation, which is why the chain is incomplete.

Consequences:

- `npx drizzle-kit generate` diffs against the last snapshot it can find
  (`0004`), so it would emit SQL that repeats changes already applied by
  `0005`–`0009`. Do not run it until the chain is rebuilt.
- A generated `meta/0009_snapshot.json` was produced during this work and
  discarded: it was a stale copy of `0004` and would have made the problem
  worse.
- `npx drizzle-kit migrate` is unaffected; it applies the journal entries in
  order and is what CI and local rehearsal use.
- Rebuild the snapshots from the real schema (or squash the hand-written
  migrations into a fresh baseline) **before** authoring `0010`.

## Commit map

| Commit | Branch | Meaning |
| --- | --- | --- |
| `d2f68b8` | `main` | Ignore generated test reports |
| `fb66fba` | `main` / `origin/main` | Quiz-builder plan |
| `479d317` | local `main` | Fluid component foundation |
| `315f53e` | local `main` | Responsive local date/time picker |
| `9a0a3fc` | local `main` | Fluid navigation and URL-backed Discover tabs |
| `23f0ae3` | local `main` | Fluid Profile inputs, badges, buttons |
| `75e1d20` | feature branch | Fluid owner actions and confirmation dialog |
| `f83401e` | feature branch | Add sharp for cover processing |
| `7fa1289` | feature branch | Expand schema and validation |
| `bc8c798` | feature branch | Add cover presets and Unsplash proxy |
| `c76e651` | feature branch | Autosave drafts and covers |
| `9ca9d51` | feature branch | Atomic multi-question ballots |
| `18d8d1b` | feature branch | Stacked question editor |
| `0fc4317` | feature branch | Voting/results/Discover surfaces |
| `9de50a0` | feature branch | Quiz and load-flow tests |
| `ecc8887`–`eaa8971` | `feat/phase-2-poll-polish` | Poll polish phases 1–5 (PR #5) |
| `3b5103b` | `main` | Human-readable share slugs |
| `b1e8cb9` | `main` | Hover image controls and paste |
| `6921175` | `main` / `origin/main` | Share-slug and image-control docs |
| `c63b369` | local `main` | Database clock for `updated_at` writes |
| `fe346e5` | local `main` | `0009`: validate option changes on published quizzes |
| `464e733` | local `main` | CI runs the database suites against Postgres |

## Domain model

The deployed model since `0006` keeps `events` as the quiz identity and adds
required `questions`; questions own options and each question has its own pick
type. `ballot_answers` stores selected options per question while `votes`
remains the quiz-level ballot/identity row. Legacy `vote_picks` and
`votes.option_id` still exist in production and are removed by `0010`.

| Concept | Where |
| --- | --- |
| Quiz lifecycle | `draft` → `scheduled` → `open` → `closed` / `cancelled` |
| Visibility | `unlisted`, `discoverable`, `passcode` (one exclusive enum) |
| Pick format | Per question: `single` or `top_n` (2–8) |
| Question cap | 1–20 required questions; 2–8 options per question |
| Voting window | `opens_at` / `closes_at`, evaluated against the database clock |
| Identity | A signed-in user, or a guest session token held in a cookie |
| Cover | `cover_kind` (`preset`, `unsplash`, `upload`, `none`), `cover_ref`, `cover_meta` |
| Share link | Optional `events.slug`, unique when present, resolved by the same `/events/[id]` route |
| Draft concurrency | `events.draft_version` optimistic version gate |

Ballots are immutable once submitted. Database triggers enforce answer shape,
question/option ownership, contiguous Top-N ranks, and the close/edit boundary.

## Key decisions

**Database clock for the voting window.** `clock_timestamp()` from Postgres
decides whether voting is open, not the application server's clock. A ballot
that would land after the closing time is rolled back at the end of the
transaction.

**Database clock for write timestamps.** Every `updated_at` write uses
`clock_timestamp()`, not a JavaScript `new Date()`. This covers `saveQuiz`,
the scheduled→open transition in `lib/events/voting.ts`, and the Drizzle
`$onUpdate` for `events`, `questions`, and `options` (now
``sql`clock_timestamp()` ``). App-clock writes could land before `created_at`
when the server clock lagged the database, tripping the
`updated_at >= created_at` checks. `tests/integration/save-quiz.test.ts` has a
skew regression test that moves the app clock ten seconds back.

**Shared lock for voters, exclusive lock for close/edit.** A ballot takes
`FOR KEY SHARE` on the quiz/event row. Close and date edits take `FOR UPDATE`,
so a ballot either commits before the close or is rejected.
`tests/integration/concurrency.test.ts` proves the boundary.

**Versioned result snapshots.** A snapshot's version is the number of submitted
ballots. Submitted ballots are never deleted, so the version is monotonic.
Open-quiz results are snapshotted per question. Closed results are cached as
final.

**Caching follows quiz state.** Open quizzes use a short Redis cache with
single-flight; closed results use a long TTL. Public results use
`Cache-Control: public, s-maxage=1` while open and a long
`stale-while-revalidate` once closed; drafts and passcode quizzes are
`private, no-store`.

**Rate limits are best effort.** Upstash limits fail open. Limits are
identity-first so shared IPs are not punished.

**Discovery is opt-in.** Only `discoverable` quizzes appear in `/discover`.
`/` is currently an alias until a static, no-database landing page replaces it.

**Quiz model.** A quiz holds 1–20 required questions. Each question chooses
`Pick one` or `Pick top N` independently; there is no quiz-wide pick type.
Voters use one stacked page, an answered count, and one final atomic submit.
Reorder uses drag plus up/down buttons; duplicate and delete are explicit, with
confirmation for delete.

**Times.** Store UTC. Render viewer-local time with a timezone label and
countdown. No timezone column.

**Edit rules.** Title/description may change anytime; dates only before close.
Never reopen a closed quiz. Block moving the start into the future once ballots
exist. Invalidate listing/results caches and show an “edited” marker. Question
types, options, and picks lock after votes.

**Covers.** Every quiz can show a cover in the builder, quiz page, and Discover
card. The active direction is app-owned preset/pattern artwork supplied later,
plus authenticated custom uploads. Both paths need a crop step that persists the
crop/focal data in `cover_meta`. Uploads accept PNG/JPEG/WebP, enforce size caps,
resize to WebP, strip EXIF, require login, and are rate-limited. Unsplash is not
part of the current roadmap; its route and metadata code remain in the tree for
now but should not block cover work. The exact wireframe radii and aspect ratio
are still deferred.

**Migration sequence.** No legacy compatibility validator is needed because
there are no real users. `0006` expanded/backfilled questions, question-owned
options, ballot answers, and covers; deploy code after it. `0009` repairs the
option-change validation that `0006` missed. `0010` contracts legacy
fields/tables only after the new model is proven in production. Reordering
constraints are `DEFERRABLE INITIALLY DEFERRED`.

**Legacy `options.event_id`.** The column still exists but the application
never writes it, so it is `NULL` for every app-created option. No active trigger
reads it: the trigger functions resolve the quiz through
`questions.event_id`. Two historical references remain in
`db/schema/triggers.ts` (lines 30 and 281), which is explicitly not exported
from the active schema. Drop the column in `0010`; nothing else needs to change.

**Account deletion is last.** Strip PII, delete sessions/accounts/drafts,
retain a tombstone user so ballots stay intact, and close or unlist the user's
open quizzes. The social link (platform + handle, HTTPS `instagram.com`/`x.com`
only) has its own migration gate.

## What is implemented

- Fluid foundation: registry components, token mappings, springs, provider,
  hover system, scoped Inter, and AGENTS motion rules.
- Responsive date/time picker with Popover + Calendar, time input, timezone
  label, presets, disabled past dates, and route-lazy loading.
- Fluid navigation, URL-backed Discover tabs, Fluid Profile inputs/badges, and
  Fluid owner actions with confirmation dialogs.
- Schema: `questions`, `options.question_id`, `ballot_answers`, cover
  fields, `draftVersion`, and updated relations.
- Migration `0006`: expand/backfill, deferrable question/option ordering,
  question-level triggers, ballot immutability/validation, caps. Rehearsed
  locally with legacy single-choice and Top-N fixtures, then applied to Neon.
- Quiz builder: stacked questions, independent pick types, drag/up-down
  reorder, duplicate/delete confirmation, autosave with version conflicts.
- Phase 1 reliability fixes: question/option inserts use database timestamps,
  first-save draft URLs sync correctly, autosave failures stop retry loops and
  use a stable status surface, and unknown save/publish errors are logged
  without exposing user content.
- Phase 2 poll pass: user-facing copy says poll/response instead of quiz/ballot,
  text fields and selects are visibly editable, the builder is compact, question
  and option descriptions are removed, the date-picker popover mounts normally,
  status tabs are compact, and profile settings are cleaned up. Internal
  identifiers and database column names are unchanged.
- Follow-up poll polish (PR #5): selected Discover tabs keep the raised pill
  without the orange focus treatment or shadow; neutral badges use a sky tint;
  option images use an inline thumbnail button plus popover; the cover editor is
  compact with a persisted focal point; and the whole Discover card is
  clickable with Lucide metadata icons.
- Cover flow: preset patterns, client image preparation, sharp/WebP upload,
  focal-point rendering on cards and poll pages, and legacy Unsplash rendering.
  The picker no longer offers Unsplash, but its route, cache, credit, and
  metadata paths remain for existing covers.
- Share slugs and image controls: creators can set a normalized, unique
  `/events/<slug>` link with debounced availability checking; `events.slug` is
  additive (migration `0008`). The cover preview and option image panel accept
  uploads, clipboard paste, and removal, with a hover/focus toolbar on the
  cover and an undo window for removal.
- Multi-question voting: one stacked page, answered count, atomic batched
  answer insert, per-question results, cache/version updates.
- Tests and load scripts: quiz validation, quiz integrity, date picker,
  updated voting/concurrency/results tests and request payloads.
- Database-clock writes: `saveQuiz`, the scheduled→open transition, and the
  Drizzle `$onUpdate` hooks all use `clock_timestamp()`; a skew regression test
  covers it.
- Migration `0009`: replaces `validate_published_quiz_questions()` so option
  changes on a published quiz are rejected. It is the only function `0009`
  touches and it is not yet applied to production.
- CI: unit and integration are separate steps; integration runs against a
  disposable Postgres service container, and both the Vitest guard and
  `playwright.config.ts` fail closed in CI if the database suites would skip.

## Rehearsal and test status

- Script split: `npm test` runs **unit tests only**; `npm run test:integration`
  is the database step and `npm run test:e2e` is Playwright. A plain `npm test`
  never touches the database and cannot catch the DB-level guards.
- Unit: **14 files / 75 tests** pass. The whole suite in one process exceeds the
  90 s command budget because of import time, so it is verified as three split
  runs (8 files/35 tests, 4 files/34 tests, 2 files/6 tests).
- Integration: **5 files / 31 tests** pass on three databases — the base test
  database, `pickem_fresh_0009` (fresh `0000`–`0009`), and
  `pickem_fresh_0008` (fresh `0000`–`0008`, then upgraded to `0009`). Per file:
  `quiz-integrity` 13, `save-quiz` 5, `slug-route` 5, `voting` 5,
  `concurrency` 3. The earlier 4-file / 23-test figure predates the slug tests.
- Playwright: **5 tests in 4 files**; `share-slug` passed 1/1. The full e2e run
  needs port 3000 free and a single worker.
- Lint, typecheck, and workflow YAML parse pass. The production build is part of
  the new CI workflow but has not been re-run on GitHub.
- Migration rehearsal: fresh `0000`–`0009` and upgrade `0008`→`0009` both end at
  migration `0009` with 10 recorded migrations. `pg_dump --schema-only` output is
  **identical** for the two databases (1342 lines), so `0009` behaves the same
  on a fresh chain and an upgraded one.
- `0009` adds 5 `quiz-integrity` gap tests, including the option-publish
  validation that previously let a published quiz's options be changed.
- Performance: one `saveQuiz` publish of 20 questions × 8 options (160 options)
  took **810.1 ms** against the local test container. This is a single-sample
  measurement, not a benchmark.
- Known flake: the passcode e2e failed once on a cold dev-server start and then
  passed 3/3. No trace was retained because Playwright clears `test-results`;
  treat it as a cold-start timing issue until it recurs.
- Not verified: the new CI workflow has not run on GitHub (nothing pushed); the
  `0009` production migration and a production create/vote smoke test are
  pending; Phase 3 cookie-forging tests were deliberately skipped.
- Rehearsal found and fixed: question-level per-question ballot totals being
  overwritten by option rows, wrapped Drizzle/Postgres errors losing the
  “closed” mapping, ambiguous PL/pgSQL `event_id` variable in a trigger, a
  Playwright helper reading `DATABASE_URL_TEST` before `.env.local` loaded, an
  invalid `Intl.DateTimeFormat` option plus locale hydration mismatch, and
  `updated_at` written from a lagging app clock.
- Post-PR #6 share-slug/image-control work: lint, typecheck, production build,
  and the unit suite pass locally. Visual verification of the flat selected tab
  and cover toolbar used a temporary local route that was removed afterward.
- User-facing copy now says poll/response; identifiers such as `quiz_id`,
  `saveQuiz`, `home:polls`, and `poll-options/` remain intentionally unchanged.
- Earlier edits failed with `Unknown: FileSystem.writeFile` on several files,
  including `wizard.tsx`, `actions.ts`, and `profile/page.tsx`. After restart,
  edits succeeded. `actions.ts` currently has no read-only flag, no lock file,
  and the user account has `FullControl`; no persistent cause was found. Treat
  it as a transient file-lock/tool write failure. Do not retry more than twice;
  stop and report instead.
- Compact cover editing and persisted focal points are implemented. Final
  owner-supplied pattern artwork and wireframe/aspect-ratio decisions remain
  open.
- Social link and account deletion are not implemented.
- Docs previously claimed quiz work had not started; this file and the quiz plan
  are now the source of truth for the current state.

## Known gaps and next steps

1. **Apply `0009` to production.** The owner applies it; it is not applied here.
   Then run a production create/vote smoke test before any contract work.
2. **Push and watch the new CI.** Nothing is pushed yet. The first run of the
   Postgres-service workflow is the real proof that the suites run rather than
   skip; confirm the integration step reports tests instead of 0 s.
3. **Rebuild the Drizzle snapshots.** Snapshots `0005`–`0009` are missing, so
   `drizzle-kit generate` would diff against `0004` and emit duplicate SQL.
   Rebuild or squash the chain before authoring `0010`.
4. **Migration `0010` contract.** Drop legacy `vote_picks`, `votes.option_id` /
   `is_submitted`, `options.event_id`, and `events.pick_type` / `max_picks`
   only after the production smoke test and the snapshot rebuild.
5. **Edit published polls.** Implement the edit rules, edited marker, cache
   invalidation, and immutable question/options after votes with concurrency
   tests.
6. **Finalize cover artwork.** Replace the remaining generated preset gradients
   with the owner-supplied pattern/preset artwork when it exists and confirm the
   final wireframe aspect ratio.
7. **Social link.** Separate migration gate for platform + handle constrained to
   HTTPS `instagram.com` / `x.com`.
8. **Account deletion.** Do last: anonymize PII, delete sessions/accounts/drafts,
   retain a tombstone user, and close/unlist open polls.
9. **Scale work.** Tune `DATABASE_POOL_MAX`, re-measure vote throughput on a
   preview deployment, and replace ~2-second polling with WebSockets when the
   edge-request cost justifies it. Ranked scoring remains undefined.
10. **Repository hygiene.** Delete merged feature branches after their PRs land
    and keep new work off merged branches.

## Resume checklist

1. `git status`, `git log --oneline -10`, and confirm branch/HEAD.
2. Read the changed files before editing; do not assume previous partial edits
   landed.
3. Never apply a migration, start Docker/Postgres, push, or deploy without
   explicit approval.
4. Before any database command, assert `DATABASE_URL_TEST` resolves to loopback;
   before e2e, assert port 3000 is free and use one worker.
5. Keep local commits small and logical. Do not push until the owner reviews.
6. When editing fails twice, stop and report the exact error rather than
   looping.

## Time estimate

The quiz engineering and DB-backed test work are done. What remains is
owner-gated: apply `0009` and smoke-test production (under an hour), push and
watch the first real CI run, rebuild the Drizzle snapshots, then author `0010`.
Treat the snapshot rebuild as the risky item; budget a focused session for it.

## Environment notes

- `DATABASE_URL` is the runtime URL (pooled in production);
  `DATABASE_URL_UNPOOLED` is the direct connection used for migrations.
- `DATABASE_POOL_MAX` defaults to 5; `db/index.ts` sets `prepare: false` for the
  Neon transaction pooler.
- Better Auth uses the configured static `BETTER_AUTH_URL`; trusted origins are
  configured with `BETTER_AUTH_TRUSTED_ORIGINS` (production URL only in
  production).
- `DATABASE_URL_TEST` must point at a disposable branch. The test suites refuse
  to run when the target host matches any known production host; locally it must
  resolve to loopback (`127.0.0.1`/`localhost`). Assert the host before every DB
  command.
- `npm test` runs unit tests only. Use `npm run test:integration` for the
  database suites; `npm run test:e2e` for Playwright. In CI both database steps
  fail closed if `DATABASE_URL_TEST` or `ALLOW_TEST_DB_MUTATION=1` is missing.
- `npx drizzle-kit migrate` applies the journal in order and is safe. Do not run
  `npx drizzle-kit generate` until the snapshot chain is rebuilt; see
  “Migration snapshots”.
- npm 12 blocks dependency scripts by default. `package.json` carries
  `allowScripts` entries for `esbuild` and `unrs-resolver`; use an isolated
  user-config for installs when needed. Do not weaken the global npm policy.
- The Fluid Functionalism skill is installed globally at
  `C:\Users\Dell\.agents\skills\fluid-functionalism`.
