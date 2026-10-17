CREATE TYPE "public"."pick_type" AS ENUM('single', 'top_n');--> statement-breakpoint
CREATE TABLE "vote_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vote_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"rank_position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vote_picks_vote_option_unique" UNIQUE("vote_id","option_id"),
	CONSTRAINT "vote_picks_vote_rank_unique" UNIQUE("vote_id","rank_position"),
	CONSTRAINT "vote_picks_rank_position_chk" CHECK ("vote_picks"."rank_position" between 1 and 8)
);
--> statement-breakpoint
ALTER TABLE "votes" ALTER COLUMN "option_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "pick_type" "pick_type" DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "max_picks" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "is_submitted" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_id_event_id_unique" UNIQUE("id","event_id");--> statement-breakpoint
ALTER TABLE "vote_picks" ADD CONSTRAINT "vote_picks_vote_event_fk" FOREIGN KEY ("vote_id","event_id") REFERENCES "public"."votes"("id","event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_picks" ADD CONSTRAINT "vote_picks_option_event_fk" FOREIGN KEY ("option_id","event_id") REFERENCES "public"."options"("id","event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vote_picks_event_option_rank_idx" ON "vote_picks" USING btree ("event_id","option_id","rank_position");--> statement-breakpoint
CREATE INDEX "vote_picks_vote_id_idx" ON "vote_picks" USING btree ("vote_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_pick_type_max_picks_chk" CHECK (("events"."pick_type" = 'single' and "events"."max_picks" = 1) or ("events"."pick_type" = 'top_n' and "events"."max_picks" >= 2 and "events"."max_picks" <= 8));--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_option_requires_submitted_chk" CHECK ("votes"."option_id" is null or "votes"."is_submitted" = true);
