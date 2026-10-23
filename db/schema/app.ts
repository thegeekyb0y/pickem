import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const eventStatus = pgEnum("event_status", [
  "draft",
  "scheduled",
  "open",
  "closed",
  "cancelled",
]);

export const eventVisibility = pgEnum("event_visibility", [
  "unlisted",
  "discoverable",
  "passcode",
]);

export const optionImageSource = pgEnum("option_image_source", [
  "blob",
  "external_url",
]);

export const guestHandlePlatform = pgEnum("guest_handle_platform", [
  "instagram",
  "x",
]);

export const pickType = pgEnum("pick_type", ["single", "top_n"]);
export const coverKind = pgEnum("quiz_cover_kind", ["preset", "unsplash", "upload", "none"]);
export type QuizCoverKind = (typeof coverKind.enumValues)[number];

export type QuizCoverMeta = {
  photoId?: string;
  photographer?: string;
  photographerUrl?: string;
  photoUrl?: string;
  downloadLocation?: string;
  dominantColor?: string;
  focalPoint?: { x: number; y: number };
};

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorUserId: text("creator_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    status: eventStatus("status").default("draft").notNull(),
    visibility: eventVisibility("visibility").default("unlisted").notNull(),
    passcodeHash: text("passcode_hash"),
    draftStep: integer("draft_step"),
    draftVersion: integer("draft_version").default(1).notNull(),
    coverKind: coverKind("cover_kind").default("none").notNull(),
    coverRef: text("cover_ref"),
    coverMeta: jsonb("cover_meta").$type<QuizCoverMeta | null>(),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("events_creator_user_id_idx").on(table.creatorUserId),
    index("events_status_window_idx").on(table.status, table.opensAt, table.closesAt),
    index("events_visibility_idx").on(table.visibility),
    check("events_title_length_chk", sql`length(trim(${table.title})) between 1 and 160`),
    check("events_window_chk", sql`${table.closesAt} > ${table.opensAt}`),
    check("events_updated_after_created_chk", sql`${table.updatedAt} >= ${table.createdAt}`),
    check(
      "events_passcode_visibility_chk",
      sql`(${table.visibility} = 'passcode' and ${table.passcodeHash} is not null) or (${table.visibility} <> 'passcode' and ${table.passcodeHash} is null)`,
    ),
    check(
      "events_draft_step_chk",
      sql`${table.draftStep} is null or ${table.draftStep} between 1 and 3`,
    ),
    check("events_draft_version_chk", sql`${table.draftVersion} >= 1`),
    check(
      "events_cover_shape_chk",
      sql`(${table.coverKind} = 'none' and ${table.coverRef} is null) or (${table.coverKind} <> 'none' and ${table.coverRef} is not null)`,
    ),
  ],
);

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    prompt: text("prompt").default("").notNull(),
    description: text("description"),
    pickType: pickType("pick_type").default("single").notNull(),
    maxPicks: integer("max_picks").default(1).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("questions_event_id_idx").on(table.eventId),
    unique("questions_event_sort_order_unique").on(table.eventId, table.sortOrder),
    unique("questions_id_event_id_unique").on(table.id, table.eventId),
    check("questions_prompt_length_chk", sql`length(trim(${table.prompt})) <= 500`),
    check("questions_description_length_chk", sql`${table.description} is null or length(${table.description}) <= 2000`),
    check("questions_sort_order_chk", sql`${table.sortOrder} >= 0`),
    check("questions_updated_after_created_chk", sql`${table.updatedAt} >= ${table.createdAt}`),
    check(
      "questions_pick_type_max_picks_chk",
      sql`(${table.pickType} = 'single' and ${table.maxPicks} = 1) or (${table.pickType} = 'top_n' and ${table.maxPicks} between 2 and 8)`,
    ),
  ],
);

export const options = pgTable(
  "options",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    description: text("description"),
    imageSource: optionImageSource("image_source"),
    imageUrl: text("image_url"),
    imageBlobKey: text("image_blob_key"),
    imageAlt: text("image_alt"),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("options_question_id_idx").on(table.questionId),
    unique("options_question_sort_order_unique").on(table.questionId, table.sortOrder),
    unique("options_id_question_id_unique").on(table.id, table.questionId),
    check("options_label_length_chk", sql`length(trim(${table.label})) between 1 and 120`),
    check(
      "options_description_length_chk",
      sql`${table.description} is null or length(${table.description}) <= 1000`,
    ),
    check("options_image_alt_length_chk", sql`${table.imageAlt} is null or length(${table.imageAlt}) <= 180`),
    check("options_sort_order_chk", sql`${table.sortOrder} >= 0`),
    check("options_updated_after_created_chk", sql`${table.updatedAt} >= ${table.createdAt}`),
    check(
      "options_image_shape_chk",
      sql`(
        ${table.imageSource} is null
        and ${table.imageUrl} is null
        and ${table.imageBlobKey} is null
      ) or (
        ${table.imageSource} = 'external_url'
        and ${table.imageUrl} is not null
        and ${table.imageBlobKey} is null
      ) or (
        ${table.imageSource} = 'blob'
        and ${table.imageUrl} is not null
        and ${table.imageBlobKey} is not null
      )`,
    ),
  ],
);

export const voteGuestSessions = pgTable(
  "vote_guest_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    guestSessionTokenHash: text("guest_session_token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    unique("vote_guest_sessions_event_token_unique").on(table.eventId, table.guestSessionTokenHash),
    index("vote_guest_sessions_token_hash_idx").on(table.guestSessionTokenHash),
    index("vote_guest_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const eventPasscodeUnlocks = pgTable(
  "event_passcode_unlocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    unlockSessionTokenHash: text("unlock_session_token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    unique("event_passcode_unlocks_event_token_unique").on(table.eventId, table.unlockSessionTokenHash),
    index("event_passcode_unlocks_token_hash_idx").on(table.unlockSessionTokenHash),
    index("event_passcode_unlocks_expires_at_idx").on(table.expiresAt),
  ],
);

export const votes = pgTable(
  "votes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    voterUserId: text("voter_user_id").references(() => user.id, { onDelete: "set null" }),
    guestSessionId: uuid("guest_session_id").references(() => voteGuestSessions.id, {
      onDelete: "restrict",
    }),
    guestHandle: text("guest_handle"),
    guestHandlePlatform: guestHandlePlatform("guest_handle_platform"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("votes_event_id_idx").on(table.eventId),
    index("votes_voter_user_id_idx").on(table.voterUserId),
    index("votes_guest_session_id_idx").on(table.guestSessionId),
    uniqueIndex("votes_logged_in_dedupe_unique")
      .on(table.eventId, table.voterUserId)
      .where(sql`${table.voterUserId} is not null`),
    uniqueIndex("votes_guest_dedupe_unique")
      .on(table.eventId, table.guestSessionId)
      .where(sql`${table.guestSessionId} is not null`),
    unique("votes_id_event_id_unique").on(table.id, table.eventId),
    check(
      "votes_identity_shape_chk",
      sql`(
        ${table.voterUserId} is not null
        and ${table.guestSessionId} is null
        and ${table.guestHandle} is null
        and ${table.guestHandlePlatform} is null
      ) or (
        ${table.voterUserId} is null
        and ${table.guestSessionId} is not null
        and ${table.guestHandle} is not null
        and ${table.guestHandlePlatform} is not null
      )`,
    ),
    check(
      "votes_guest_handle_length_chk",
      sql`${table.guestHandle} is null or length(trim(${table.guestHandle})) between 1 and 40`,
    ),
  ],
);

export const ballotAnswers = pgTable(
  "ballot_answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    voteId: uuid("vote_id").notNull(),
    eventId: uuid("event_id").notNull(),
    questionId: uuid("question_id").notNull(),
    optionId: uuid("option_id").notNull(),
    rankPosition: integer("rank_position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("ballot_answers_vote_question_option_unique").on(table.voteId, table.questionId, table.optionId),
    unique("ballot_answers_vote_question_rank_unique").on(table.voteId, table.questionId, table.rankPosition),
    foreignKey({
      name: "ballot_answers_vote_event_fk",
      columns: [table.voteId, table.eventId],
      foreignColumns: [votes.id, votes.eventId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ballot_answers_question_event_fk",
      columns: [table.questionId, table.eventId],
      foreignColumns: [questions.id, questions.eventId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ballot_answers_option_question_fk",
      columns: [table.optionId, table.questionId],
      foreignColumns: [options.id, options.questionId],
    }),
    index("ballot_answers_question_option_rank_idx").on(
      table.questionId,
      table.optionId,
      table.rankPosition,
    ),
    index("ballot_answers_vote_id_idx").on(table.voteId),
    check("ballot_answers_rank_position_chk", sql`${table.rankPosition} between 1 and 8`),
  ],
);

/*
 * Drizzle's current unique builder does not express DEFERRABLE constraints.
 * The question and option sort-order UNIQUE constraints are marked
 * DEFERRABLE INITIALLY DEFERRED by the authored expand migration so an order
 * swap can be applied atomically.
 */

export const eventsRelations = relations(events, ({ many, one }) => ({
  creator: one(user, {
    fields: [events.creatorUserId],
    references: [user.id],
  }),
  questions: many(questions),
  votes: many(votes),
  guestSessions: many(voteGuestSessions),
  passcodeUnlocks: many(eventPasscodeUnlocks),
}));

export const questionsRelations = relations(questions, ({ many, one }) => ({
  event: one(events, {
    fields: [questions.eventId],
    references: [events.id],
  }),
  options: many(options),
  answers: many(ballotAnswers),
}));

export const optionsRelations = relations(options, ({ many, one }) => ({
  question: one(questions, {
    fields: [options.questionId],
    references: [questions.id],
  }),
  answers: many(ballotAnswers),
}));

export const voteGuestSessionsRelations = relations(voteGuestSessions, ({ many, one }) => ({
  event: one(events, {
    fields: [voteGuestSessions.eventId],
    references: [events.id],
  }),
  votes: many(votes),
}));

export const eventPasscodeUnlocksRelations = relations(eventPasscodeUnlocks, ({ one }) => ({
  event: one(events, {
    fields: [eventPasscodeUnlocks.eventId],
    references: [events.id],
  }),
}));

export const votesRelations = relations(votes, ({ one, many }) => ({
  event: one(events, {
    fields: [votes.eventId],
    references: [events.id],
  }),
  voter: one(user, {
    fields: [votes.voterUserId],
    references: [user.id],
  }),
  guestSession: one(voteGuestSessions, {
    fields: [votes.guestSessionId],
    references: [voteGuestSessions.id],
  }),
  answers: many(ballotAnswers),
}));

export const ballotAnswersRelations = relations(ballotAnswers, ({ one }) => ({
  vote: one(votes, {
    fields: [ballotAnswers.voteId],
    references: [votes.id],
  }),
  event: one(events, {
    fields: [ballotAnswers.eventId],
    references: [events.id],
  }),
  question: one(questions, {
    fields: [ballotAnswers.questionId],
    references: [questions.id],
  }),
  option: one(options, {
    fields: [ballotAnswers.optionId],
    references: [options.id],
  }),
}));
