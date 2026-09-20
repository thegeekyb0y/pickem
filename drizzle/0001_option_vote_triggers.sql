CREATE OR REPLACE FUNCTION prevent_deleting_voted_option()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "votes" WHERE "votes"."option_id" = OLD."id") THEN
    RAISE EXCEPTION 'Cannot delete an option that has votes';
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
  RAISE EXCEPTION 'Votes are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS prevent_updating_vote_trigger ON "votes";--> statement-breakpoint
CREATE TRIGGER prevent_updating_vote_trigger
BEFORE UPDATE ON "votes"
FOR EACH ROW
EXECUTE FUNCTION prevent_updating_vote();
