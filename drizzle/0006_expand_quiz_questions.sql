CREATE TYPE "public"."quiz_cover_kind" AS ENUM('preset', 'unsplash', 'upload', 'none');--> statement-breakpoint

ALTER TABLE "events" ADD COLUMN "draft_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cover_kind" "quiz_cover_kind" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cover_ref" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cover_meta" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_draft_version_chk" CHECK ("draft_version" >= 1);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_cover_shape_chk"
  CHECK (("cover_kind" = 'none' AND "cover_ref" IS NULL) OR ("cover_kind" <> 'none' AND "cover_ref" IS NOT NULL));--> statement-breakpoint

CREATE TABLE "questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "prompt" text DEFAULT '' NOT NULL,
  "description" text,
  "pick_type" "pick_type" DEFAULT 'single' NOT NULL,
  "max_picks" integer DEFAULT 1 NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "questions_event_sort_order_unique"
    UNIQUE ("event_id", "sort_order") DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "questions_id_event_id_unique" UNIQUE ("id", "event_id"),
  CONSTRAINT "questions_prompt_length_chk" CHECK (length(trim("prompt")) <= 500),
  CONSTRAINT "questions_description_length_chk"
    CHECK ("description" IS NULL OR length("description") <= 2000),
  CONSTRAINT "questions_sort_order_chk" CHECK ("sort_order" >= 0),
  CONSTRAINT "questions_updated_after_created_chk" CHECK ("updated_at" >= "created_at"),
  CONSTRAINT "questions_pick_type_max_picks_chk" CHECK (
    ("pick_type" = 'single' AND "max_picks" = 1) OR
    ("pick_type" = 'top_n' AND "max_picks" BETWEEN 2 AND 8)
  )
);--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_event_id_events_id_fk"
  FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "questions_event_id_idx" ON "questions" USING btree ("event_id");--> statement-breakpoint

-- Each existing event represented one poll question. Preserve its settings and
-- options as the first required question before the new app is deployed.
INSERT INTO "questions" ("event_id", "prompt", "pick_type", "max_picks", "sort_order")
SELECT "id", "title", "pick_type", "max_picks", 0 FROM "events";--> statement-breakpoint

ALTER TABLE "options" ADD COLUMN "question_id" uuid;--> statement-breakpoint
UPDATE "options" AS o
SET "question_id" = q."id"
FROM "questions" AS q
WHERE q."event_id" = o."event_id";--> statement-breakpoint
ALTER TABLE "options" ALTER COLUMN "question_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "options" ALTER COLUMN "event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "options" DROP CONSTRAINT "options_event_sort_order_unique";--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_question_sort_order_unique"
  UNIQUE ("question_id", "sort_order") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_id_question_id_unique"
  UNIQUE ("id", "question_id");--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_question_id_questions_id_fk"
  FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_question_event_fk"
  FOREIGN KEY ("question_id", "event_id") REFERENCES "public"."questions"("id", "event_id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "options_question_id_idx" ON "options" USING btree ("question_id");--> statement-breakpoint

CREATE TABLE "ballot_answers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vote_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "question_id" uuid NOT NULL,
  "option_id" uuid NOT NULL,
  "rank_position" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ballot_answers_vote_question_option_unique"
    UNIQUE ("vote_id", "question_id", "option_id"),
  CONSTRAINT "ballot_answers_vote_question_rank_unique"
    UNIQUE ("vote_id", "question_id", "rank_position"),
  CONSTRAINT "ballot_answers_rank_position_chk" CHECK ("rank_position" BETWEEN 1 AND 8)
);--> statement-breakpoint
ALTER TABLE "ballot_answers" ADD CONSTRAINT "ballot_answers_vote_event_fk"
  FOREIGN KEY ("vote_id", "event_id") REFERENCES "public"."votes"("id", "event_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "ballot_answers" ADD CONSTRAINT "ballot_answers_question_event_fk"
  FOREIGN KEY ("question_id", "event_id") REFERENCES "public"."questions"("id", "event_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "ballot_answers" ADD CONSTRAINT "ballot_answers_option_question_fk"
  FOREIGN KEY ("option_id", "question_id") REFERENCES "public"."options"("id", "question_id");--> statement-breakpoint
CREATE INDEX "ballot_answers_question_option_rank_idx"
  ON "ballot_answers" USING btree ("question_id", "option_id", "rank_position");--> statement-breakpoint
CREATE INDEX "ballot_answers_vote_id_idx" ON "ballot_answers" USING btree ("vote_id");--> statement-breakpoint

-- Copy old single-choice picks and ranked picks into the new per-question rows.
INSERT INTO "ballot_answers" ("vote_id", "event_id", "question_id", "option_id", "rank_position", "created_at")
SELECT v."id", v."event_id", q."id", v."option_id", 1, v."created_at"
FROM "votes" AS v
JOIN "questions" AS q ON q."event_id" = v."event_id"
WHERE v."is_submitted" = true AND v."option_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "ballot_answers" ("vote_id", "event_id", "question_id", "option_id", "rank_position", "created_at")
SELECT p."vote_id", p."event_id", q."id", p."option_id", p."rank_position", p."created_at"
FROM "vote_picks" AS p
JOIN "questions" AS q ON q."event_id" = p."event_id";--> statement-breakpoint

-- Replace the legacy event-level validation triggers. The previous and new
-- application versions are not dual-schema compatible; deploy the new code
-- immediately after this expand/backfill migration.
DROP TRIGGER IF EXISTS "prevent_deleting_voted_option_trigger" ON "options";--> statement-breakpoint
DROP TRIGGER IF EXISTS "prevent_updating_vote_trigger" ON "votes";--> statement-breakpoint
DROP TRIGGER IF EXISTS "prevent_deleting_submitted_vote_trigger" ON "votes";--> statement-breakpoint
DROP TRIGGER IF EXISTS "validate_vote_shape_trigger" ON "votes";--> statement-breakpoint
DROP TRIGGER IF EXISTS "prevent_updating_vote_pick_trigger" ON "vote_picks";--> statement-breakpoint
DROP TRIGGER IF EXISTS "prevent_deleting_vote_pick_trigger" ON "vote_picks";--> statement-breakpoint
DROP TRIGGER IF EXISTS "validate_vote_pick_trigger" ON "vote_picks";--> statement-breakpoint
DROP TRIGGER IF EXISTS "validate_submitted_vote_trigger" ON "votes";--> statement-breakpoint
DROP TRIGGER IF EXISTS "validate_submitted_vote_pick_trigger" ON "vote_picks";--> statement-breakpoint
DROP TRIGGER IF EXISTS "validate_published_top_n_question_trigger" ON "events";--> statement-breakpoint

DROP FUNCTION IF EXISTS prevent_deleting_voted_option() CASCADE;--> statement-breakpoint
DROP FUNCTION IF EXISTS prevent_updating_vote() CASCADE;--> statement-breakpoint
DROP FUNCTION IF EXISTS prevent_deleting_submitted_vote() CASCADE;--> statement-breakpoint
DROP FUNCTION IF EXISTS prevent_mutating_vote_pick() CASCADE;--> statement-breakpoint
DROP FUNCTION IF EXISTS validate_vote_shape() CASCADE;--> statement-breakpoint
DROP FUNCTION IF EXISTS validate_vote_pick() CASCADE;--> statement-breakpoint
DROP FUNCTION IF EXISTS validate_submitted_ballot() CASCADE;--> statement-breakpoint
DROP FUNCTION IF EXISTS validate_published_top_n_question() CASCADE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_quiz_question_cap()
RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM "events" WHERE "id" = NEW."event_id" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "votes" WHERE "event_id" = NEW."event_id") THEN
    RAISE EXCEPTION 'Questions cannot be added after ballots exist';
  END IF;
  IF (SELECT count(*) FROM "questions" WHERE "event_id" = NEW."event_id") >= 20 THEN
    RAISE EXCEPTION 'A quiz can have at most 20 questions';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER enforce_quiz_question_cap_trigger
BEFORE INSERT ON "questions"
FOR EACH ROW EXECUTE FUNCTION enforce_quiz_question_cap();--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_question_option_cap()
RETURNS trigger AS $$
DECLARE
  quiz_id uuid;
BEGIN
  SELECT "event_id" INTO quiz_id FROM "questions" WHERE "id" = NEW."question_id";
  PERFORM 1 FROM "events" WHERE "id" = quiz_id FOR UPDATE;
  IF (SELECT count(*) FROM "options" WHERE "question_id" = NEW."question_id") >= 8 THEN
    RAISE EXCEPTION 'A question can have at most eight options';
  END IF;
  IF EXISTS (SELECT 1 FROM "votes" WHERE "event_id" = quiz_id) THEN
    RAISE EXCEPTION 'Question options are immutable after ballots exist';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER enforce_question_option_cap_trigger
BEFORE INSERT ON "options"
FOR EACH ROW EXECUTE FUNCTION enforce_question_option_cap();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_mutating_voted_question()
RETURNS trigger AS $$
DECLARE
  event_id uuid;
  has_ballots boolean;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    event_id := OLD."event_id";
  ELSE
    event_id := NEW."event_id";
  END IF;
  PERFORM 1 FROM "events" WHERE "id" = event_id FOR UPDATE;
  SELECT EXISTS (SELECT 1 FROM "votes" WHERE "votes"."event_id" = event_id)
    INTO has_ballots;

  IF has_ballots THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'A question cannot be deleted after ballots exist';
    END IF;
    IF NEW."pick_type" IS DISTINCT FROM OLD."pick_type"
      OR NEW."max_picks" IS DISTINCT FROM OLD."max_picks" THEN
      RAISE EXCEPTION 'Question pick settings cannot change after ballots exist';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER prevent_mutating_voted_question_trigger
BEFORE UPDATE OR DELETE ON "questions"
FOR EACH ROW EXECUTE FUNCTION prevent_mutating_voted_question();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_mutating_voted_option()
RETURNS trigger AS $$
DECLARE
  has_ballots boolean;
  quiz_id uuid;
  question_pick_type "pick_type";
  question_max_picks integer;
  remaining_options integer;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."question_id" IS DISTINCT FROM OLD."question_id" THEN
    RAISE EXCEPTION 'An option cannot move to a different question';
  END IF;

  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM "ballot_answers" a WHERE a."option_id" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'Cannot delete an option that has submitted answers';
  END IF;

  SELECT "event_id" INTO quiz_id FROM "questions" WHERE "id" = OLD."question_id";
  PERFORM 1 FROM "events" WHERE "id" = quiz_id FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM "votes" v
    JOIN "questions" q ON q."event_id" = v."event_id"
    WHERE q."id" = OLD."question_id"
  ) INTO has_ballots;
  IF has_ballots THEN
    RAISE EXCEPTION 'Question options are immutable after ballots exist';
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT "pick_type", "max_picks" INTO question_pick_type, question_max_picks
    FROM "questions" WHERE "id" = OLD."question_id";
    SELECT count(*)::integer - 1 INTO remaining_options
    FROM "options" WHERE "question_id" = OLD."question_id";
    IF question_pick_type = 'top_n'
      AND question_max_picks > remaining_options
      AND EXISTS (
        SELECT 1 FROM "events" e
        JOIN "questions" q ON q."event_id" = e."id"
        WHERE q."id" = OLD."question_id" AND e."status" <> 'draft'
      ) THEN
      RAISE EXCEPTION 'Cannot delete an option while the rank limit exceeds the remaining options';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER prevent_mutating_voted_option_trigger
BEFORE UPDATE OR DELETE ON "options"
FOR EACH ROW EXECUTE FUNCTION prevent_mutating_voted_option();--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_adding_option_after_ballots()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "questions" q
    JOIN "votes" v ON v."event_id" = q."event_id"
    WHERE q."id" = NEW."question_id"
  ) THEN
    RAISE EXCEPTION 'Question options are immutable after ballots exist';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER prevent_adding_option_after_ballots_trigger
BEFORE INSERT ON "options"
FOR EACH ROW EXECUTE FUNCTION prevent_adding_option_after_ballots();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_published_quiz_questions()
RETURNS trigger AS $$
DECLARE
  quiz_id uuid;
  quiz_status "event_status";
  question_count integer;
  question_row record;
BEGIN
  IF TG_TABLE_NAME = 'events' THEN
    quiz_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
  ELSE
    quiz_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."event_id" ELSE NEW."event_id" END;
  END IF;

  SELECT "status" INTO quiz_status FROM "events" WHERE "id" = quiz_id;
  IF NOT FOUND OR quiz_status = 'draft' THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::integer INTO question_count
  FROM "questions" WHERE "event_id" = quiz_id;
  IF question_count NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'A published quiz needs between one and twenty questions';
  END IF;

  FOR question_row IN
    SELECT q."id", q."prompt", q."pick_type", q."max_picks", count(o."id")::integer AS option_count
    FROM "questions" q
    LEFT JOIN "options" o ON o."question_id" = q."id"
    WHERE q."event_id" = quiz_id
    GROUP BY q."id"
  LOOP
    IF length(trim(question_row."prompt")) = 0 THEN
      RAISE EXCEPTION 'Every published question needs a prompt';
    END IF;
    IF question_row.option_count NOT BETWEEN 2 AND 8 THEN
      RAISE EXCEPTION 'Every published question needs between two and eight options';
    END IF;
    IF question_row."pick_type" = 'top_n' AND question_row."max_picks" > question_row.option_count THEN
      RAISE EXCEPTION 'The rank limit cannot exceed the number of question options';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_published_quiz_from_event_trigger
AFTER INSERT OR UPDATE ON "events"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION validate_published_quiz_questions();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_published_quiz_from_question_trigger
AFTER INSERT OR UPDATE OR DELETE ON "questions"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION validate_published_quiz_questions();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_published_quiz_from_option_trigger
AFTER INSERT OR UPDATE OR DELETE ON "options"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION validate_published_quiz_questions();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_mutating_submitted_vote()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Submitted ballots are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER prevent_updating_submitted_vote_trigger
BEFORE UPDATE ON "votes"
FOR EACH ROW EXECUTE FUNCTION prevent_mutating_submitted_vote();--> statement-breakpoint
CREATE TRIGGER prevent_deleting_submitted_vote_trigger
BEFORE DELETE ON "votes"
FOR EACH ROW EXECUTE FUNCTION prevent_mutating_submitted_vote();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_mutating_ballot_answer()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Submitted answers are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER prevent_updating_ballot_answer_trigger
BEFORE UPDATE ON "ballot_answers"
FOR EACH ROW EXECUTE FUNCTION prevent_mutating_ballot_answer();--> statement-breakpoint
CREATE TRIGGER prevent_deleting_ballot_answer_trigger
BEFORE DELETE ON "ballot_answers"
FOR EACH ROW EXECUTE FUNCTION prevent_mutating_ballot_answer();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_ballot_answer()
RETURNS trigger AS $$
DECLARE
  question_pick_type "pick_type";
  question_max_picks integer;
  quiz_status "event_status";
  quiz_opens_at timestamptz;
  quiz_closes_at timestamptz;
  parent_event_id uuid;
BEGIN
  SELECT "event_id" INTO parent_event_id FROM "votes" WHERE "id" = NEW."vote_id";
  IF NOT FOUND OR parent_event_id <> NEW."event_id" THEN
    RAISE EXCEPTION 'Answer and ballot must belong to the same quiz';
  END IF;

  SELECT q."pick_type", q."max_picks", e."status", e."opens_at", e."closes_at"
  INTO question_pick_type, question_max_picks, quiz_status, quiz_opens_at, quiz_closes_at
  FROM "questions" q
  JOIN "events" e ON e."id" = q."event_id"
  WHERE q."id" = NEW."question_id" AND q."event_id" = NEW."event_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question not found for this quiz';
  END IF;
  IF quiz_status NOT IN ('open', 'scheduled')
    OR quiz_opens_at > clock_timestamp()
    OR quiz_closes_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Voting is not open';
  END IF;
  IF question_pick_type = 'single' AND NEW."rank_position" <> 1 THEN
    RAISE EXCEPTION 'Pick one answers use rank 1';
  END IF;
  IF question_pick_type = 'top_n' AND NEW."rank_position" > question_max_picks THEN
    RAISE EXCEPTION 'Answer rank exceeds the question maximum';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER validate_ballot_answer_trigger
BEFORE INSERT ON "ballot_answers"
FOR EACH ROW EXECUTE FUNCTION validate_ballot_answer();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_complete_quiz_ballot()
RETURNS trigger AS $$
DECLARE
  question_row record;
  answer_count integer;
  min_rank integer;
  max_rank integer;
  quiz_status "event_status";
  quiz_opens_at timestamptz;
  quiz_closes_at timestamptz;
BEGIN
  SELECT "status", "opens_at", "closes_at"
  INTO quiz_status, quiz_opens_at, quiz_closes_at
  FROM "events" WHERE "id" = NEW."event_id";
  IF NOT FOUND OR quiz_status NOT IN ('open', 'scheduled')
    OR quiz_opens_at > clock_timestamp()
    OR quiz_closes_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Voting is not open';
  END IF;

  FOR question_row IN
    SELECT q."id", q."pick_type", q."max_picks"
    FROM "questions" q
    WHERE q."event_id" = NEW."event_id"
    ORDER BY q."sort_order"
  LOOP
    SELECT count(*)::integer, min("rank_position"), max("rank_position")
    INTO answer_count, min_rank, max_rank
    FROM "ballot_answers"
    WHERE "vote_id" = NEW."id" AND "question_id" = question_row."id";

    IF question_row."pick_type" = 'single' THEN
      IF answer_count <> 1 OR min_rank <> 1 OR max_rank <> 1 THEN
        RAISE EXCEPTION 'Every Pick one question needs exactly one answer';
      END IF;
    ELSIF answer_count < 1 OR answer_count > question_row."max_picks"
      OR min_rank <> 1 OR max_rank <> answer_count THEN
      RAISE EXCEPTION 'Every Pick top N question needs one to its maximum in contiguous ranks';
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM "questions" WHERE "event_id" = NEW."event_id") THEN
    RAISE EXCEPTION 'A quiz needs at least one question';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_complete_quiz_ballot_trigger
AFTER INSERT ON "votes"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION validate_complete_quiz_ballot();--> statement-breakpoint
