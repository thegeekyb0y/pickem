CREATE OR REPLACE FUNCTION prevent_deleting_voted_option()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "votes"
    WHERE "votes"."option_id" = OLD."id"
      AND "votes"."event_id" = OLD."event_id"
  ) OR EXISTS (
    SELECT 1
    FROM "vote_picks"
    WHERE "vote_picks"."option_id" = OLD."id"
      AND "vote_picks"."event_id" = OLD."event_id"
  ) THEN
    RAISE EXCEPTION 'Cannot delete an option that has submitted picks';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "events"
    WHERE "events"."id" = OLD."event_id"
      AND "events"."status" <> 'draft'
      AND "events"."pick_type" = 'top_n'
      AND "events"."max_picks" > (
        SELECT count(*) - 1 FROM "options" WHERE "options"."event_id" = OLD."event_id"
      )
  ) THEN
    RAISE EXCEPTION 'Cannot delete an option while the configured rank limit exceeds the remaining options';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS prevent_deleting_voted_option_trigger ON "options";--> statement-breakpoint
CREATE TRIGGER prevent_deleting_voted_option_trigger
BEFORE DELETE ON "options"
FOR EACH ROW
EXECUTE FUNCTION prevent_deleting_voted_option();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_updating_vote()
RETURNS trigger AS $$
BEGIN
  IF OLD."is_submitted" = false
    AND NEW."is_submitted" = true
    AND ROW(
      NEW."id", NEW."event_id", NEW."option_id", NEW."voter_user_id",
      NEW."guest_session_id", NEW."guest_handle", NEW."guest_handle_platform",
      NEW."created_at"
    ) IS NOT DISTINCT FROM ROW(
      OLD."id", OLD."event_id", OLD."option_id", OLD."voter_user_id",
      OLD."guest_session_id", OLD."guest_handle", OLD."guest_handle_platform",
      OLD."created_at"
    ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Submitted votes are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS prevent_updating_vote_trigger ON "votes";--> statement-breakpoint
CREATE TRIGGER prevent_updating_vote_trigger
BEFORE UPDATE ON "votes"
FOR EACH ROW
EXECUTE FUNCTION prevent_updating_vote();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_deleting_submitted_vote()
RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'Submitted votes cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS prevent_deleting_submitted_vote_trigger ON "votes";--> statement-breakpoint
CREATE TRIGGER prevent_deleting_submitted_vote_trigger
BEFORE DELETE ON "votes"
FOR EACH ROW
EXECUTE FUNCTION prevent_deleting_submitted_vote();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_mutating_vote_pick()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Submitted picks are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS prevent_updating_vote_pick_trigger ON "vote_picks";--> statement-breakpoint
DROP TRIGGER IF EXISTS prevent_deleting_vote_pick_trigger ON "vote_picks";--> statement-breakpoint
CREATE TRIGGER prevent_updating_vote_pick_trigger
BEFORE UPDATE ON "vote_picks"
FOR EACH ROW
EXECUTE FUNCTION prevent_mutating_vote_pick();--> statement-breakpoint
CREATE TRIGGER prevent_deleting_vote_pick_trigger
BEFORE DELETE ON "vote_picks"
FOR EACH ROW
EXECUTE FUNCTION prevent_mutating_vote_pick();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_vote_shape()
RETURNS trigger AS $$
DECLARE
  event_pick_type "pick_type";
  event_status "event_status";
  event_opens_at timestamptz;
  event_closes_at timestamptz;
BEGIN
  SELECT "pick_type", "status", "opens_at", "closes_at"
    INTO event_pick_type, event_status, event_opens_at, event_closes_at
    FROM "events"
    WHERE "id" = NEW."event_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question not found';
  END IF;
  IF event_status NOT IN ('open', 'scheduled')
    OR event_opens_at > now()
    OR event_closes_at <= now() THEN
    RAISE EXCEPTION 'Voting is not open';
  END IF;

  IF event_pick_type = 'single' THEN
    IF NEW."option_id" IS NULL OR NEW."is_submitted" IS NOT TRUE THEN
      RAISE EXCEPTION 'Single-choice ballots require one option';
    END IF;
  ELSE
    IF NEW."option_id" IS NOT NULL OR NEW."is_submitted" IS NOT FALSE THEN
      RAISE EXCEPTION 'Top-N ballots must be created pending with no single option';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS validate_vote_shape_trigger ON "votes";--> statement-breakpoint
CREATE TRIGGER validate_vote_shape_trigger
BEFORE INSERT ON "votes"
FOR EACH ROW
EXECUTE FUNCTION validate_vote_shape();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_vote_pick()
RETURNS trigger AS $$
DECLARE
  parent_submitted boolean;
  parent_event_id uuid;
  event_pick_type "pick_type";
  event_max_picks integer;
BEGIN
  SELECT "is_submitted", "event_id"
    INTO parent_submitted, parent_event_id
    FROM "votes"
    WHERE "id" = NEW."vote_id";
  IF NOT FOUND OR parent_submitted IS NOT FALSE THEN
    RAISE EXCEPTION 'Picks can only be added while a ballot is being submitted';
  END IF;
  IF parent_event_id <> NEW."event_id" THEN
    RAISE EXCEPTION 'Pick and ballot must belong to the same question';
  END IF;

  SELECT "pick_type", "max_picks"
    INTO event_pick_type, event_max_picks
    FROM "events"
    WHERE "id" = NEW."event_id";
  IF event_pick_type <> 'top_n' THEN
    RAISE EXCEPTION 'Ranked picks are only valid for top-N questions';
  END IF;
  IF NEW."rank_position" > event_max_picks THEN
    RAISE EXCEPTION 'Rank exceeds the question maximum';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS validate_vote_pick_trigger ON "vote_picks";--> statement-breakpoint
CREATE TRIGGER validate_vote_pick_trigger
BEFORE INSERT ON "vote_picks"
FOR EACH ROW
EXECUTE FUNCTION validate_vote_pick();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_submitted_ballot()
RETURNS trigger AS $$
DECLARE
  ballot_id uuid;
  ballot_event_id uuid;
  ballot_option_id uuid;
  ballot_submitted boolean;
  event_pick_type "pick_type";
  event_max_picks integer;
  pick_count integer;
  min_rank integer;
  max_rank integer;
BEGIN
  IF TG_TABLE_NAME = 'votes' THEN
    ballot_id := NEW."id";
    ballot_event_id := NEW."event_id";
  ELSE
    ballot_id := NEW."vote_id";
    ballot_event_id := NEW."event_id";
  END IF;

  SELECT "is_submitted", "option_id"
    INTO ballot_submitted, ballot_option_id
    FROM "votes"
    WHERE "id" = ballot_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF ballot_submitted IS NOT TRUE THEN
    RAISE EXCEPTION 'A ballot must be fully submitted before commit';
  END IF;

  SELECT "pick_type", "max_picks"
    INTO event_pick_type, event_max_picks
    FROM "events"
    WHERE "id" = ballot_event_id;
  SELECT count(*)::integer, min("rank_position"), max("rank_position")
    INTO pick_count, min_rank, max_rank
    FROM "vote_picks"
    WHERE "vote_id" = ballot_id;

  IF event_pick_type = 'single' THEN
    IF ballot_option_id IS NULL OR pick_count <> 0 THEN
      RAISE EXCEPTION 'Single-choice ballot must contain exactly one option';
    END IF;
  ELSE
    IF ballot_option_id IS NOT NULL OR pick_count < 1 OR pick_count > event_max_picks
      OR min_rank <> 1 OR max_rank <> pick_count THEN
      RAISE EXCEPTION 'Top-N ballot must contain 1 to max_picks contiguous ranks';
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS validate_submitted_vote_trigger ON "votes";--> statement-breakpoint
DROP TRIGGER IF EXISTS validate_submitted_vote_pick_trigger ON "vote_picks";--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_submitted_vote_trigger
AFTER INSERT OR UPDATE ON "votes"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_submitted_ballot();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_submitted_vote_pick_trigger
AFTER INSERT ON "vote_picks"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_submitted_ballot();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_published_top_n_question()
RETURNS trigger AS $$
DECLARE
  option_count integer;
BEGIN
  IF NEW."pick_type" = 'top_n' AND NEW."status" <> 'draft' THEN
    SELECT count(*)::integer
      INTO option_count
      FROM "options"
      WHERE "options"."event_id" = NEW."id";
    IF option_count < NEW."max_picks" THEN
      RAISE EXCEPTION 'Top-N maximum cannot exceed the number of question options';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND (NEW."pick_type" IS DISTINCT FROM OLD."pick_type"
      OR NEW."max_picks" IS DISTINCT FROM OLD."max_picks")
    AND EXISTS (SELECT 1 FROM "votes" WHERE "votes"."event_id" = NEW."id") THEN
    RAISE EXCEPTION 'Pick type and maximum cannot change after ballots exist';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS validate_published_top_n_question_trigger ON "events";--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_published_top_n_question_trigger
AFTER INSERT OR UPDATE ON "events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_published_top_n_question();
