-- `options.event_id` is a legacy column that the application never writes, so
-- the previous definition resolved option-triggered validation to a NULL quiz
-- and silently skipped the 2–8 option rule. Resolve the quiz through the
-- owning question instead; the events and questions branches are unchanged.
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
  ELSIF TG_TABLE_NAME = 'options' THEN
    SELECT q."event_id" INTO quiz_id
    FROM "questions" q
    WHERE q."id" = CASE
      WHEN TG_OP = 'DELETE' THEN OLD."question_id"
      ELSE NEW."question_id"
    END;
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
