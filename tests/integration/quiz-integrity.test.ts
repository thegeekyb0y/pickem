import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { assertNotProductionDatabase, resolveProductionDatabaseHosts, resolveTargetDatabaseHost } from "../../scripts/db-guard.mjs";
import { applyTestDatabaseUrl, resolveTestDatabaseUrl } from "../helpers/local-env";

const testUrl = resolveTestDatabaseUrl();
const enabled = Boolean(testUrl && process.env.ALLOW_TEST_DB_MUTATION === "1");
if (enabled && testUrl) {
  assertNotProductionDatabase({
    label: "the quiz integrity suite",
    targetHost: resolveTargetDatabaseHost(),
    productionHosts: resolveProductionDatabaseHosts(),
  });
  applyTestDatabaseUrl(testUrl);
}

const sql = enabled && testUrl ? postgres(testUrl, { max: 2, prepare: false }) : null;
const eventIds: string[] = [];
const userIds: string[] = [];

type QuestionSeed = {
  prompt?: string;
  pickType?: "single" | "top_n";
  maxPicks?: number;
  options?: number;
};

async function createQuiz(questionSeeds: QuestionSeed[] = [{ options: 2 }]) {
  if (!sql) throw new Error("Integration database is not enabled");
  const eventId = crypto.randomUUID();
  const creatorId = `quiz-owner-${crypto.randomUUID()}`;
  const questionIds = questionSeeds.map(() => crypto.randomUUID());
  const optionIds = questionSeeds.map((question) =>
    Array.from({ length: question.options ?? 2 }, () => crypto.randomUUID()),
  );
  eventIds.push(eventId);
  userIds.push(creatorId);

  await sql`
    insert into "user" (id, name, email, email_verified)
    values (${creatorId}, 'Quiz owner', ${`${creatorId}@example.test`}, false)
  `;
  await sql.begin(async (tx) => {
    await tx`
      insert into events (id, creator_user_id, title, status, visibility, opens_at, closes_at)
      values (
        ${eventId}, ${creatorId}, 'Integrity quiz', 'open', 'unlisted',
        clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 hour'
      )
    `;
    for (const [index, question] of questionSeeds.entries()) {
      await tx`
        insert into questions (id, event_id, prompt, pick_type, max_picks, sort_order)
        values (
          ${questionIds[index]}, ${eventId}, ${question.prompt ?? `Question ${index + 1}`},
          ${question.pickType ?? "single"}, ${question.maxPicks ?? 1}, ${index}
        )
      `;
      for (const [optionIndex, optionId] of optionIds[index].entries()) {
        await tx`
          insert into options (id, question_id, label, sort_order)
          values (${optionId}, ${questionIds[index]}, ${`Option ${optionIndex + 1}`}, ${optionIndex})
        `;
      }
    }
  });
  return { eventId, creatorId, questionIds, optionIds };
}

async function createVoter(voterId: string) {
  if (!sql) throw new Error("Integration database is not enabled");
  await sql`
    insert into "user" (id, name, email, email_verified)
    values (${voterId}, 'Quiz voter', ${`${voterId}@example.test`}, false)
  `;
  userIds.push(voterId);
}

describe.skipIf(!enabled)("multi-question database integrity triggers", () => {
  afterEach(async () => {
    if (!sql) return;
    for (const id of eventIds.splice(0)) await sql`delete from events where id = ${id}`;
    for (const id of userIds.splice(0)) await sql`delete from "user" where id = ${id}`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("requires a prompt and 2–8 options on each published question", async () => {
    if (!sql) return;
    const quiz = await createQuiz([{ prompt: "", options: 1 }]);
    await expect(sql`
      update events set status = 'closed' where id = ${quiz.eventId}
    `).rejects.toThrow(/question|option/i);
  });

  it("rejects a Top N maximum larger than the question's option count", async () => {
    if (!sql) return;
    const quiz = await createQuiz([{ prompt: "Rank", pickType: "top_n", maxPicks: 3, options: 2 }]);
    await expect(sql`
      update events set status = 'closed' where id = ${quiz.eventId}
    `).rejects.toThrow(/rank limit/i);
  });

  it("caps a quiz at twenty questions and each question at eight options", async () => {
    if (!sql) return;
    const quiz = await createQuiz(Array.from({ length: 20 }, (_, index) => ({
      prompt: `Question ${index + 1}`,
      options: 2,
    })));
    await expect(sql`
      insert into questions (event_id, prompt, pick_type, max_picks, sort_order)
      values (${quiz.eventId}, 'Question 21', 'single', 1, 20)
    `).rejects.toThrow(/at most 20/i);

    const eightOptions = await createQuiz([{ options: 8 }]);
    await expect(sql`
      insert into options (question_id, label, sort_order)
      values (${eightOptions.questionIds[0]}, 'Option nine', 8)
    `).rejects.toThrow(/at most eight/i);
  });

  it("allows question and option order swaps in one transaction", async () => {
    if (!sql) return;
    const quiz = await createQuiz([{ prompt: "First" }, { prompt: "Second" }]);
    await sql.begin(async (tx) => {
      await tx`update questions set sort_order = 1 where id = ${quiz.questionIds[0]}`;
      await tx`update questions set sort_order = 0 where id = ${quiz.questionIds[1]}`;
      await tx`update options set sort_order = 1 where id = ${quiz.optionIds[0][0]}`;
      await tx`update options set sort_order = 0 where id = ${quiz.optionIds[0][1]}`;
    });
    const [firstQuestion] = await sql`
      select id from questions where event_id = ${quiz.eventId} order by sort_order limit 1
    `;
    const [firstOption] = await sql`
      select id from options where question_id = ${firstQuestion.id} order by sort_order limit 1
    `;
    expect(firstQuestion.id).toBe(quiz.questionIds[1]);
    expect(firstOption.id).toBe(quiz.optionIds[1][0]);
  });

  it("rejects a ballot missing any required question", async () => {
    if (!sql) return;
    const quiz = await createQuiz([{ options: 2 }, { prompt: "Second", options: 2 }]);
    const voterId = `quiz-voter-${crypto.randomUUID()}`;
    await createVoter(voterId);
    await expect(sql`
      insert into votes (event_id, voter_user_id) values (${quiz.eventId}, ${voterId})
    `).rejects.toThrow(/answer/i);
  });

  it("rejects gaps in Pick top N ranks at ballot commit", async () => {
    if (!sql) return;
    const quiz = await createQuiz([{ pickType: "top_n", maxPicks: 3, options: 3 }]);
    const voterId = `quiz-voter-${crypto.randomUUID()}`;
    await createVoter(voterId);
    await expect(sql.begin(async (tx) => {
      const [vote] = await tx`
        insert into votes (event_id, voter_user_id) values (${quiz.eventId}, ${voterId}) returning id
      `;
      await tx`
        insert into ballot_answers (vote_id, event_id, question_id, option_id, rank_position)
        values
          (${vote.id}, ${quiz.eventId}, ${quiz.questionIds[0]}, ${quiz.optionIds[0][0]}, 1),
          (${vote.id}, ${quiz.eventId}, ${quiz.questionIds[0]}, ${quiz.optionIds[0][1]}, 3)
      `;
    })).rejects.toThrow(/contiguous ranks/i);
  });

  it("locks question types and options after the first submitted ballot", async () => {
    if (!sql) return;
    const quiz = await createQuiz();
    const voterId = `quiz-voter-${crypto.randomUUID()}`;
    await createVoter(voterId);
    await sql.begin(async (tx) => {
      const [vote] = await tx`
        insert into votes (event_id, voter_user_id) values (${quiz.eventId}, ${voterId}) returning id
      `;
      await tx`
        insert into ballot_answers (vote_id, event_id, question_id, option_id, rank_position)
        values (${vote.id}, ${quiz.eventId}, ${quiz.questionIds[0]}, ${quiz.optionIds[0][0]}, 1)
      `;
    });
    await expect(sql`
      update questions set prompt = 'Changed type', pick_type = 'top_n', max_picks = 2
      where id = ${quiz.questionIds[0]}
    `).rejects.toThrow(/pick settings/i);
    await expect(sql`
      update options set label = 'Changed option' where id = ${quiz.optionIds[0][0]}
    `).rejects.toThrow(/immutable/i);
    await expect(sql`
      delete from options where id = ${quiz.optionIds[0][0]}
    `).rejects.toThrow(/submitted answers/i);
  });

  it("keeps submitted votes and answer rows immutable", async () => {
    if (!sql) return;
    const quiz = await createQuiz();
    const voterId = `quiz-voter-${crypto.randomUUID()}`;
    await createVoter(voterId);
    const answerId = crypto.randomUUID();
    const voteId = await sql.begin(async (tx) => {
      const [vote] = await tx`
        insert into votes (event_id, voter_user_id) values (${quiz.eventId}, ${voterId}) returning id
      `;
      await tx`
        insert into ballot_answers (id, vote_id, event_id, question_id, option_id, rank_position)
        values (${answerId}, ${vote.id}, ${quiz.eventId}, ${quiz.questionIds[0]}, ${quiz.optionIds[0][0]}, 1)
      `;
      return vote.id as string;
    });
    await expect(sql`update votes set voter_user_id = 'changed' where id = ${voteId}`)
      .rejects.toThrow(/immutable/i);
    await expect(sql`update ballot_answers set rank_position = 2 where id = ${answerId}`)
      .rejects.toThrow(/immutable/i);
    await expect(sql`delete from ballot_answers where id = ${answerId}`)
      .rejects.toThrow(/immutable/i);
  });
});
