-- Published-poll edit marker.
--
-- Null means the owner has not edited the poll since publishing. Existing
-- published polls stay unmarked, so the column is added without a default.
-- Only the owner-edit path writes it, using the database clock. `updated_at`
-- is not a sound substitute because ballot submission and close-early both
-- touch it, and the Drizzle `$onUpdate` hook fires on every row update.
alter table "events" add column "edited_at" timestamp with time zone;

alter table "events"
  add constraint "events_edited_after_created_chk"
  check ("edited_at" is null or "edited_at" >= "created_at");
