# Project context

A summary of what Pickem is, the decisions behind it, and where the work
stands. Written so a fresh session can pick up without re-deriving the history.

Last updated: 2026-10-23.

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

- `origin/main` is `4d299e0 Merge pull request #4 from
  thegeekyb0y/fix/draft-save-reliability`. PRs #1–#4 are merged, so `main`
  contains the multi-question builder and Phase 1 reliability fixes. Production
  is expected to track `main`; confirm the Vercel deployment before the smoke
  test.
- Local `main` and `origin/main` are aligned at `4d299e0`.
- Local `feature/fluid-quiz-builder` is `cf101c5`, fully contained in
  `origin/main`. Phase 2 work is uncommitted on `feat/phase-2-poll-polish`,
  branched from `origin/main`.
- Safety branches: `backup/wip-quiz-builder` (`f3abaa6`) and
  `backup/pre-split-37cc032` (`37cc032`)
- Phase 1 reliability fixes, merged as PR #4, cover the question/option
  timestamp constraint failure, draft URL sync on first save, the stable
  autosave status surface, and safer publish/save error copy.
- Migration `drizzle/0006_expand_quiz_questions.sql` is applied to Neon
  production. The legacy model was backfilled into questions, options, and
  ballot answers. Migration `0007` is applied to production and replaces the
  stale question-guard trigger whose `event_id` variable collided with
  `votes.event_id`; the planned contract migration is now `0008` and still needs
  a fresh production create/vote smoke test plus a Neon backup branch.
- Local test container `pickem-test-pg` is running on port `55432`; integration
  and e2e suites point at it through `DATABASE_URL_TEST`.

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
| `HEAD` | feature branch | Implementation-state docs |

## Domain model

Production/deployed model: `events` → `options`, `votes` → `vote_picks`.
The WIP branch keeps `events` as the quiz identity and adds required
`questions`; questions own options and each question has its own pick type.
`ballot_answers` stores selected options per question while `votes` remains the
quiz-level ballot/identity row.

| Concept | Where |
| --- | --- |
| Quiz lifecycle | `draft` → `scheduled` → `open` → `closed` / `cancelled` |
| Visibility | `unlisted`, `discoverable`, `passcode` (one exclusive enum) |
| Pick format | Per question: `single` or `top_n` (2–8) |
| Question cap | 1–20 required questions; 2–8 options per question |
| Voting window | `opens_at` / `closes_at`, evaluated against the database clock |
| Identity | A signed-in user, or a guest session token held in a cookie |
| Cover | `cover_kind` (`preset`, `unsplash`, `upload`, `none`), `cover_ref`, `cover_meta` |
| Draft concurrency | `events.draft_version` optimistic version gate |

Ballots are immutable once submitted. Database triggers enforce answer shape,
question/option ownership, contiguous Top-N ranks, and the close/edit boundary.

## Key decisions

**Database clock for the voting window.** `clock_timestamp()` from Postgres
decides whether voting is open, not the application server's clock. A ballot
that would land after the closing time is rolled back at the end of the
transaction.

**Shared lock for voters, exclusive lock for close/edit.** A ballot takes
`FOR KEY SHARE` on the quiz/event row. Close and date edits take `FOR UPDATE`,
so a ballot either commits before the close or is rejected.
`tests/integration/concurrency.test.ts` proves the boundary.

**Versioned result snapshots.** A snapshot's version is the number of submitted
ballots. Submitted ballots are never deleted, so the version is monotonic.
WIP results are snapshotted per question. Closed results are cached as final.

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
there are no real users. Migration 1 expands/backfills questions,
question-owned options, ballot answers, and covers. Deploy new code after
migration 1. Migration 2 contracts legacy fields/tables only after the new model
is proven. Reordering constraints are `DEFERRABLE INITIALLY DEFERRED`.

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
- WIP schema: `questions`, `options.question_id`, `ballot_answers`, cover
  fields, `draftVersion`, and updated relations.
- Migration `0006`: expand/backfill, deferrable question/option ordering,
  question-level triggers, ballot immutability/validation, caps. Rehearsed
  locally with legacy single-choice and Top-N fixtures, then applied to Neon.
- WIP quiz builder: stacked questions, independent pick types, drag/up-down
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
- WIP cover flow: presets, Unsplash search route/cache/credit, client image
  preparation, sharp/WebP upload, cover rendering on cards and quiz pages. The
  next cover pass replaces Unsplash with owner-supplied pattern/preset artwork,
  custom uploads, and cropping.
- WIP multi-question voting: one stacked page, answered count, atomic batched
  answer insert, per-question results, cache/version updates.
- WIP tests and load scripts: quiz validation, quiz integrity, date picker,
  updated voting/concurrency/results tests and request payloads.

## Rehearsal and test status

- Lint, typecheck, unit tests, integration tests, and production build pass.
  Unit tests: 13 files / 66 tests. Integration tests: 4 files / 16 tests,
  including the new `save-quiz` draft/publish regression.
- Migration `0006` passed local rehearsal against `pickem-test-pg`: migrations
  `0000`–`0005`, legacy seed data, then `drizzle-kit migrate` for `0006`.
  It is applied to Neon production. The old production trigger function kept an
  `event_id` variable because `0006` was edited after being applied; `0007`
  forwards the corrected `quiz_id` definition without rewriting history.
- Phase 2 re-verification: lint, typecheck, 66 unit tests, 16 integration tests,
  production build, and all 4 Playwright tests pass on
  `feat/phase-2-poll-polish`. Integration/e2e require
  `ALLOW_TEST_DB_MUTATION=1`.
- Rehearsal found and fixed: question-level per-question ballot totals being
  overwritten by option rows, wrapped Drizzle/Postgres errors losing the
  “closed” mapping, ambiguous PL/pgSQL `event_id` variable in a trigger, a
  Playwright helper reading `DATABASE_URL_TEST` before `.env.local` loaded, and
  an invalid `Intl.DateTimeFormat` option plus locale hydration mismatch.
- Phase 1 history is merged; Phase 2 changes are uncommitted on
  `feat/phase-2-poll-polish` pending review and commit.
- User-facing copy now says poll/response; identifiers such as `quiz_id`,
  `saveQuiz`, `home:polls`, and `poll-options/` remain intentionally unchanged.
- Earlier edits failed with `Unknown: FileSystem.writeFile` on several files,
  including `wizard.tsx`, `actions.ts`, and `profile/page.tsx`. After restart,
  edits succeeded. `actions.ts` currently has no read-only flag, no lock file,
  and the user account has `FullControl`; no persistent cause was found. Treat
  it as a transient file-lock/tool write failure. Do not retry more than twice;
  stop and report instead.
- Cover crop work, owner-supplied pattern artwork, and wireframe/aspect-ratio
  decisions are deferred to the cover redesign.
- Social link and account deletion are not implemented.
- Docs previously claimed quiz work had not started; this file and the quiz plan
  are now the source of truth for the WIP state.

## Known gaps and next steps

1. **Review and ship Phase 2.** Review the uncommitted poll-builder diff, commit,
   open a PR, and smoke-test create/autosave/reload/publish/vote on a preview.
   No migration is involved.
2. **Cover redesign.** Replace Unsplash with owner-supplied preset/pattern
   artwork and custom uploads, use a compact thumbnail editor, and add cropping
   that persists crop/focal data in `cover_meta`.
3. **Migration `0008` contract.** Drop legacy `vote_picks`, `votes.option_id` /
   `is_submitted`, `options.event_id`, and `events.pick_type` / `max_picks`
   only after a production create/vote smoke test. Keep it separate from UI work
   and reconcile the missing Drizzle snapshots first.
4. **Edit published polls.** Implement the edit rules, edited marker, cache
   invalidation, and immutable question/options after votes with concurrency
   tests.
5. **Social link.** Separate migration gate for platform + handle constrained to
   HTTPS `instagram.com` / `x.com`.
6. **Account deletion.** Do last: anonymize PII, delete sessions/accounts/drafts,
   retain a tombstone user, and close/unlist open polls.
7. **Scale work.** Tune `DATABASE_POOL_MAX`, re-measure vote throughput on a
   preview deployment, and replace ~2-second polling with WebSockets when the
   edge-request cost justifies it. Ranked scoring remains undefined.
8. **Repository hygiene.** Delete merged feature branches after their PRs land
   and keep new work off merged branches.

## Resume checklist

1. `git status`, `git log --oneline -10`, and confirm branch/HEAD.
2. Read the changed files before editing; do not assume previous partial edits
   landed.
3. Never apply a migration, start Docker/Postgres, push, or deploy without
   explicit approval.
4. Keep local commits small and logical. Do not push the WIP commit as final.
5. When editing fails twice, stop and report the exact error rather than
   looping.

## Time estimate

With the toolchain behaving: roughly **4–6 hours** for the remaining quiz
engineering, plus **1–2 hours** for migration rehearsal and DB-backed tests.
CI and review may add elapsed time.

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
- npm 12 blocks dependency scripts by default. `package.json` carries
  `allowScripts` entries for `esbuild` and `unrs-resolver`; use an isolated
  user-config for installs when needed. Do not weaken the global npm policy.
- The Fluid Functionalism skill is installed globally at
  `C:\Users\Dell\.agents\skills\fluid-functionalism`.
