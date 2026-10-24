ALTER TABLE "events" ADD COLUMN "slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "events_slug_unique" ON "events" USING btree ("slug") WHERE "slug" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_slug_format_chk"
  CHECK (
    "slug" IS NULL OR (
      "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      AND length("slug") BETWEEN 3 AND 48
    )
  );
