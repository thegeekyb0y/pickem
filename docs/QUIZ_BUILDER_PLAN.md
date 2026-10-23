# Quiz builder plan

This document is the implementation handoff for replacing the current one-question
poll model with quizzes containing independently configured questions.

> **Status 2026-10-23:** WIP is committed on `feature/fluid-quiz-builder`
> (latest local commits; run `git log`), with `backup/wip-quiz-builder` at
> `f3abaa6` as the safety point. Schema, migration `0006`, the builder, covers,
> multi-question voting/results, and tests exist but are not production-ready.
> Migration `0006` has been rehearsed on local Docker Postgres only and has
> **not** been applied to Neon. History is split into logical commits and pushed;
> lint, typecheck, 66 unit tests, 15 integration tests, 4 Playwright e2e tests,
> and production build pass. See
> [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) for the current state and resume
> checklist.

Keep all quiz work on a feature branch, rehearse database changes against local
Docker Postgres, and obtain explicit approval before any migration against any
database. Create a Neon backup branch before an approved Neon migration.

## Decisions

### Product model and routes

- A Quiz uses the existing `events` row and its ID. Keep `/events/<id>`.
- A Quiz contains 1–20 required Questions. Each Question has 2–8 options and its
  own `Pick one` or `Pick top N` type; Top N is 2–8. There is no quiz-wide pick
  type and nothing is asked upfront.
- Use the UI terms **Quiz**, **Question**, **Pick one**, and **Pick top N**.
- Discovery lives at `/discover`; `/` remains an alias until a static landing
  page replaces it. The eventual landing page must not make a database call per
  visit.
- Reorder questions with up/down buttons. Duplicate and delete are explicit
  actions; deletion requires confirmation.
- Voters see one stacked page, an answered-question count, and one final atomic
  submit. All questions are required.
- Store instants in UTC. Render local viewer time, its timezone label, and a
  countdown. Do not add a timezone column.

### Quiz cover

Every quiz has a cover shown in the builder, quiz page, and Discover cards.
Persist `cover_kind` (`preset`, `unsplash`, `upload`, `none`), `cover_ref`, and
`cover_meta` JSONB in the expand migration. Metadata can contain photographer
credit, photo ID, dominant color, and focal point.

Sources:

1. Presets owned by the app: gradients, patterns, and illustrations.
2. Unsplash search only through a server route. Keep `UNSPLASH_ACCESS_KEY`
   server-side; cache searches in Redis to respect the demo limit of 50 requests
   per hour. Hotlink photo URLs via a custom image loader; show photographer and
   Unsplash credit; call the Unsplash download endpoint when a photo is chosen.
   Consult current official API guidelines during implementation.
3. Vercel Blob uploads: PNG/JPEG/WebP only; enforce a size cap, resize to WebP,
   strip EXIF, require login, and rate-limit uploads.

Defer cover wireframe radii and aspect ratio until the design pass.

### Edit, identity, and privacy rules

- Owners may edit title and description at any time; dates only before close.
- Never reopen a closed quiz: closed results are cached as final.
- Once ballots exist, reject moving the start into the future. Use the same
  exclusive event-row lock as close-early (`FOR UPDATE`).
- Invalidate home-listing and results caches for relevant edits; show an
  **edited** marker.
- Once votes exist, question types, options, and picks are immutable.
- Account deletion is last: strip PII, delete sessions/accounts/drafts, retain a
  tombstone user so existing ballots remain intact, and close or unlist that
  user's open quizzes.
- Social link (platform + handle; HTTPS `instagram.com` / `x.com` only) has its
  own migration gate, separate from quiz work.

## Database migration outline (proposal only; do not run)

No compatibility validator is needed because there are no real users. Migration
1 expands and backfills while the current code is still deployed. Deploy the new
code after migration 1. Migration 2 contracts the legacy model after deployment.
Backfill one question for every existing event, copying its current pick type
and maximum; attach its existing options to that question. A legacy prompt can
be seeded from the event title and reviewed as part of backfill rehearsal.

### Migration 1: expand and backfill

Illustrative SQL (names and constraints must be reconciled with the final Drizzle
schema and existing trigger definitions before implementation):

```sql
CREATE TABLE questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  description text,
  pick_type pick_type NOT NULL DEFAULT 'single',
  max_picks integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT questions_event_sort_unique
    UNIQUE (event_id, sort_order) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT questions_id_event_unique UNIQUE (id, event_id),
  CONSTRAINT questions_pick_shape_chk CHECK (
    (pick_type = 'single' AND max_picks = 1) OR
    (pick_type = 'top_n' AND max_picks BETWEEN 2 AND 8)
  )
);

ALTER TABLE options ADD COLUMN question_id uuid;
INSERT INTO questions (event_id, prompt, pick_type, max_picks, sort_order)
SELECT id, title, pick_type, max_picks, 0 FROM events;
UPDATE options o SET question_id = q.id
FROM questions q WHERE q.event_id = o.event_id;
ALTER TABLE options ALTER COLUMN question_id SET NOT NULL;
ALTER TABLE options ADD CONSTRAINT options_question_fk
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE;
ALTER TABLE options ADD CONSTRAINT options_id_question_unique
  UNIQUE (id, question_id);
ALTER TABLE options ADD CONSTRAINT options_question_event_fk
  FOREIGN KEY (question_id, event_id) REFERENCES questions(id, event_id) ON DELETE CASCADE;
ALTER TABLE options ADD CONSTRAINT options_question_sort_unique
  UNIQUE (question_id, sort_order) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE ballot_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vote_id uuid NOT NULL,
  event_id uuid NOT NULL,
  question_id uuid NOT NULL,
  option_id uuid NOT NULL,
  rank_position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ballot_answers_vote_event_fk
    FOREIGN KEY (vote_id, event_id) REFERENCES votes(id, event_id) ON DELETE CASCADE,
  CONSTRAINT ballot_answers_question_event_fk
    FOREIGN KEY (question_id, event_id) REFERENCES questions(id, event_id) ON DELETE CASCADE,
  CONSTRAINT ballot_answers_option_question_fk
    FOREIGN KEY (option_id, question_id) REFERENCES options(id, question_id),
  CONSTRAINT ballot_answers_vote_question_option_unique
    UNIQUE (vote_id, question_id, option_id),
  CONSTRAINT ballot_answers_vote_question_rank_unique
    UNIQUE (vote_id, question_id, rank_position),
  CONSTRAINT ballot_answers_rank_chk CHECK (rank_position BETWEEN 1 AND 8)
);

-- Copy existing single-choice selections as rank 1.
INSERT INTO ballot_answers (vote_id, event_id, question_id, option_id, rank_position)
SELECT v.id, v.event_id, q.id, v.option_id, 1
FROM votes v
JOIN questions q ON q.event_id = v.event_id
WHERE v.option_id IS NOT NULL;
-- Copy existing Top-N selections, preserving their rank order.
INSERT INTO ballot_answers (vote_id, event_id, question_id, option_id, rank_position)
SELECT p.vote_id, p.event_id, q.id, p.option_id, p.rank_position
FROM vote_picks p
JOIN questions q ON q.event_id = p.event_id;

ALTER TABLE events
  ADD COLUMN cover_kind text NOT NULL DEFAULT 'none',
  ADD COLUMN cover_ref text,
  ADD COLUMN cover_meta jsonb;
ALTER TABLE events ADD CONSTRAINT events_cover_kind_chk
  CHECK (cover_kind IN ('preset', 'unsplash', 'upload', 'none'));
```

The final schema must add needed composite unique keys and indexes, enforce cover
shape by kind, and decide exact nullability/length checks. Keep legacy columns
and tables during this phase. Existing single-pick votes backfill as rank 1;
existing ranked `vote_picks` rows backfill directly into `ballot_answers` using
their vote, event, option, and rank. Do not enable the new app until counts and
referential integrity match in rehearsal.

Port every current event-level trigger in `drizzle/0004_ordered_ballot_integrity.sql`
to question scope, with an independent acceptance test for each behavior:

- option deletion guard, including options selected in `ballot_answers`;
- Top-N maximum versus remaining question option count;
- published question validation (required question, 2–8 options, valid Top-N);
- immutability of submitted ballots and picks, and question type/options after
  votes;
- ballot shape/validation: one choice for Pick one; 1..max picks with contiguous
  ranks for Pick top N; all selections belong to the same question.

Retain one event-row lock for the close/edit-versus-submit boundary: voters take
`FOR KEY SHARE` on the Quiz/event row; close and date edits take `FOR UPDATE`.
Keep database-clock voting-window checks and passcode/access rules. A full ballot
must be submitted atomically. Use a single batched insert for all answer rows so
the number of SQL statements does not grow with question count; test this with
statement/query-count instrumentation at 1 and 20 questions.

Add an autosave version to the draft/quiz state. Every save supplies the version
it read; update conditionally and increment on success, returning a conflict on
stale versions. Live result snapshots are per question and carry the same
monotonic version gate so clients discard stale/out-of-order data.

### Deploy and migration 2: contract

Deploy the new application after migration 1. Do not add a dual-schema or legacy
compatibility validator. Once new code is live and the rehearsal confirms all
reads/writes use the new model, migration 2 removes only superseded structures.
Illustrative contract SQL:

```sql
DROP TABLE vote_picks;
ALTER TABLE votes DROP COLUMN option_id;
ALTER TABLE votes DROP COLUMN is_submitted;
ALTER TABLE options DROP CONSTRAINT options_event_sort_order_unique;
ALTER TABLE options DROP CONSTRAINT options_event_id_events_id_fk;
ALTER TABLE options DROP CONSTRAINT options_question_event_fk;
DROP INDEX options_event_id_idx;
ALTER TABLE options DROP COLUMN event_id;
ALTER TABLE events DROP CONSTRAINT events_pick_type_max_picks_chk;
ALTER TABLE events DROP COLUMN pick_type;
ALTER TABLE events DROP COLUMN max_picks;
```

Exact legacy constraint/trigger names must be inspected in the rehearsal and
removed only after confirming no new-code dependency. Retain the event-level
`votes` row as the one ballot/identity row per quiz; `ballot_answers` contains
the per-question selected options. Remove/recreate triggers and FKs transaction-
safely according to the final schema. Migration 2 must not discard event
identity, voter identity/tombstones, timestamps, or any backfilled answer.

## Ordered commit-sized work and acceptance tests

### 0. Reusable date/time picker — small commit on `main`

Implement a reusable shadcn Popover + Calendar (`react-day-picker`) and time
input, mapped to existing design tokens. Prefer native date/time inputs on phones
if usability is better. Show the viewer's timezone label, offer useful presets,
disable past dates, and close after choosing an opening time. Load the picker
only on create/edit routes. Preserve UTC storage and local-time conversion.

Acceptance: unit tests for local-to-UTC and UTC-to-local conversion around DST
and UTC/Asia-Kolkata; component tests for timezone label, presets, past-date
disablement, open-time close behavior, and mobile input path; verify create/edit
routes lazy-load it. Commit this independently while on `main`.

### Feature branch: quiz work (after step 0)

1. **Schema expand + backfill.** Add questions, `options.question_id`,
   `ballot_answers`, cover columns, constraints/indexes and all question-level
   triggers in the expand migration. Keep old structures. Acceptance: migrate
   empty and representative existing schemas locally; assert one backfilled
   question per event and every option/old ballot is mapped; each trigger gets
   a focused pass/fail test; reruns follow Drizzle migration guarantees.
2. **Draft model and autosave.** Replace event-level pick fields in new model
   code, support required questions, 20-question/2–8-option caps, deferred order
   uniqueness, optimistic version saves. Acceptance: stale save conflicts,
   concurrent reorder in one transaction, clone/delete-confirm flows, draft
   reload and all server-side validation boundaries.
3. **Cover picker.** Add preset, Unsplash, and upload pathways with the stated
   access, cache, privacy, credit, processing, and rate-limit rules. Acceptance:
   server route never exposes Unsplash key; Redis cache behavior; credit and
   download-endpoint call on selection; upload MIME/size/login/rate limits,
   WebP/EXIF handling; cover renders in builder, quiz view, Discover.
4. **Stacked builder.** Add independent question type/options, reorder buttons,
   duplicate and confirmation-protected delete. Acceptance: 1–20 questions,
   2–8 options/question, required questions, each independent Pick one/Top N,
   keyboard/screen-reader use and draft autosave conflict UI.
5. **Atomic multi-question voting and per-question results.** One stacked
   voter page, answered count, one final submit, batched answer insert, and
   versioned live snapshots/results per question. Acceptance: no partial ballot
   under a forced failure; constant statement count for 1 vs 20 questions;
   guest/signed-in/passcode and duplicate-voter tests; race close vs submit,
   database-clock boundary, cache/version stale-response tests and E2E flow.
6. **Edit published quizzes.** Implement title/description/date rules, edited
   marker, exclusive close/edit lock, no reopen, no future start after ballots,
   and immutable question/options after votes. Acceptance: competing close,
   date edit and vote transactions; cache invalidations; final closed cache
   remains final; reject prohibited edits.
7. **Social link, own migration gate.** Add platform + handle constrained to
   HTTPS `instagram.com` or `x.com`. Acceptance: URL/host normalization,
   rejection of lookalikes/other schemes, migration rollback rehearsal, visible
   profile UX and privacy behavior.
8. **Account deletion, last.** Anonymize PII; delete sessions/accounts/drafts;
   retain a tombstone user; close or unlist the user's open quizzes. Acceptance:
   existing submitted ballots remain referentially intact and unattributed,
   open quizzes are no longer active/discoverable, sessions are revoked, and
   retries are idempotent. Do not implement before the rest of quiz work.

After migration 1, deploy new code; migration 2 is a separately reviewed,
approved contract step. Do not combine either migration with the UI commits.

## Schema changes (separate from application commits)

1. Expand: `questions` (event FK, prompt/description, pick type/max, deferred
   per-event sort order); nullable then backfilled and non-null `options.question_id`;
   `ballot_answers` (vote/event/question/option/rank with composite FKs and
   per-question uniqueness); `events.cover_kind`, `cover_ref`, `cover_meta`.
2. Contract: drop legacy `vote_picks`, `votes.option_id`/`is_submitted`,
   `options.event_id`, and `events.pick_type`/`max_picks`, with legacy triggers,
   constraints, and indexes only after proving no new-code dependency.
3. Separate later gate: social-link columns/constraints. Account-deletion policy
   and implementation comes last; don't mix it into the quiz contract migration.

## Trade-offs and open questions

- Retaining `votes` as a quiz-level ballot row preserves voter deduplication and
  identity semantics; one `ballot_answers` row per selected option makes ranked
  selections and per-question aggregation straightforward, at the cost of
  composite FKs and question-aware result queries.
- Reusing `events` and `/events/<id>` avoids route/identity churn but keeps
  internal “event” terminology until a future cleanup.
- Preset covers are cheap and reliable; Unsplash adds API quota/attribution and
  policy obligations; uploads add processing, storage, abuse, and privacy work.
- Confirm before implementation: should legacy event title become the first
  question prompt during backfill (the SQL outline assumes yes); exact cover
  preset catalogue and metadata schema; upload size cap and rate limits; exact
  draft-version scope (whole quiz vs per-question); whether answered count means
  questions with at least one selection or fully validated responses; and the
  approved Neon backup/migration procedure. Cover wireframe radii/aspect ratio
  intentionally remain deferred.
