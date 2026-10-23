CREATE OR REPLACE FUNCTION public.prevent_mutating_voted_question()
RETURNS trigger AS $$
DECLARE
  quiz_id uuid;
  has_ballots boolean;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    quiz_id := OLD."event_id";
  ELSE
    quiz_id := NEW."event_id";
  END IF;
  PERFORM 1 FROM "events" WHERE "id" = quiz_id FOR UPDATE;
  SELECT EXISTS (SELECT 1 FROM "votes" WHERE "votes"."event_id" = quiz_id)
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
$$ LANGUAGE plpgsql;
