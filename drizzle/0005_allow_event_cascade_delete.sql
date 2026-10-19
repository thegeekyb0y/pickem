CREATE OR REPLACE FUNCTION prevent_deleting_voted_option()
RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

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
$$ LANGUAGE plpgsql;
