CREATE TYPE "public"."event_status" AS ENUM('draft', 'scheduled', 'open', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."event_visibility" AS ENUM('unlisted', 'discoverable', 'passcode');--> statement-breakpoint
CREATE TYPE "public"."guest_handle_platform" AS ENUM('instagram', 'x');--> statement-breakpoint
CREATE TYPE "public"."option_image_source" AS ENUM('blob', 'external_url');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_passcode_unlocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"unlock_session_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "event_passcode_unlocks_event_token_unique" UNIQUE("event_id","unlock_session_token_hash")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"visibility" "event_visibility" DEFAULT 'unlisted' NOT NULL,
	"passcode_hash" text,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_title_length_chk" CHECK (length(trim("events"."title")) between 1 and 160),
	CONSTRAINT "events_window_chk" CHECK ("events"."closes_at" > "events"."opens_at"),
	CONSTRAINT "events_updated_after_created_chk" CHECK ("events"."updated_at" >= "events"."created_at"),
	CONSTRAINT "events_passcode_visibility_chk" CHECK (("events"."visibility" = 'passcode' and "events"."passcode_hash" is not null) or ("events"."visibility" <> 'passcode' and "events"."passcode_hash" is null))
);
--> statement-breakpoint
CREATE TABLE "options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"image_source" "option_image_source",
	"image_url" text,
	"image_blob_key" text,
	"image_alt" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "options_event_sort_order_unique" UNIQUE("event_id","sort_order"),
	CONSTRAINT "options_id_event_id_unique" UNIQUE("id","event_id"),
	CONSTRAINT "options_label_length_chk" CHECK (length(trim("options"."label")) between 1 and 120),
	CONSTRAINT "options_description_length_chk" CHECK ("options"."description" is null or length("options"."description") <= 1000),
	CONSTRAINT "options_image_alt_length_chk" CHECK ("options"."image_alt" is null or length("options"."image_alt") <= 180),
	CONSTRAINT "options_sort_order_chk" CHECK ("options"."sort_order" >= 0),
	CONSTRAINT "options_updated_after_created_chk" CHECK ("options"."updated_at" >= "options"."created_at"),
	CONSTRAINT "options_image_shape_chk" CHECK ((
        "options"."image_source" is null
        and "options"."image_url" is null
        and "options"."image_blob_key" is null
      ) or (
        "options"."image_source" = 'external_url'
        and "options"."image_url" is not null
        and "options"."image_blob_key" is null
      ) or (
        "options"."image_source" = 'blob'
        and "options"."image_url" is not null
        and "options"."image_blob_key" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "vote_guest_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"guest_session_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "vote_guest_sessions_event_token_unique" UNIQUE("event_id","guest_session_token_hash")
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"voter_user_id" text,
	"guest_session_id" uuid,
	"guest_handle" text,
	"guest_handle_platform" "guest_handle_platform",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_identity_shape_chk" CHECK ((
        "votes"."voter_user_id" is not null
        and "votes"."guest_session_id" is null
        and "votes"."guest_handle" is null
        and "votes"."guest_handle_platform" is null
      ) or (
        "votes"."voter_user_id" is null
        and "votes"."guest_session_id" is not null
        and "votes"."guest_handle" is not null
        and "votes"."guest_handle_platform" is not null
      )),
	CONSTRAINT "votes_guest_handle_length_chk" CHECK ("votes"."guest_handle" is null or length(trim("votes"."guest_handle")) between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_passcode_unlocks" ADD CONSTRAINT "event_passcode_unlocks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_guest_sessions" ADD CONSTRAINT "vote_guest_sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_voter_user_id_user_id_fk" FOREIGN KEY ("voter_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_guest_session_id_vote_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."vote_guest_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_option_event_fk" FOREIGN KEY ("option_id","event_id") REFERENCES "public"."options"("id","event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "event_passcode_unlocks_token_hash_idx" ON "event_passcode_unlocks" USING btree ("unlock_session_token_hash");--> statement-breakpoint
CREATE INDEX "event_passcode_unlocks_expires_at_idx" ON "event_passcode_unlocks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "events_creator_user_id_idx" ON "events" USING btree ("creator_user_id");--> statement-breakpoint
CREATE INDEX "events_status_window_idx" ON "events" USING btree ("status","opens_at","closes_at");--> statement-breakpoint
CREATE INDEX "events_visibility_idx" ON "events" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "options_event_id_idx" ON "options" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "vote_guest_sessions_token_hash_idx" ON "vote_guest_sessions" USING btree ("guest_session_token_hash");--> statement-breakpoint
CREATE INDEX "vote_guest_sessions_expires_at_idx" ON "vote_guest_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "votes_event_id_idx" ON "votes" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "votes_option_id_idx" ON "votes" USING btree ("option_id");--> statement-breakpoint
CREATE INDEX "votes_voter_user_id_idx" ON "votes" USING btree ("voter_user_id");--> statement-breakpoint
CREATE INDEX "votes_guest_session_id_idx" ON "votes" USING btree ("guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_logged_in_dedupe_unique" ON "votes" USING btree ("event_id","voter_user_id") WHERE "votes"."voter_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "votes_guest_dedupe_unique" ON "votes" USING btree ("event_id","guest_session_id") WHERE "votes"."guest_session_id" is not null;