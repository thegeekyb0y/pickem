"use server";

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { cookies, headers } from "next/headers";
import { revalidatePath, revalidateTag } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { isVoteWindowOpen } from "@/lib/events/ballot-rules";
import {
  getClientIp,
  limitPasscodeAttempt,
  limitVoteByIdentity,
  limitVoteByIp,
} from "@/lib/rate-limit";
import {
  ballotAnswers,
  eventPasscodeUnlocks,
  events,
  options,
  questions,
  voteGuestSessions,
  votes,
} from "@/db/schema/app";
import {
  GUEST_COOKIE,
  hashGuestToken,
  hashUnlockToken,
  UNLOCK_COOKIE,
} from "@/lib/events/access";

const scrypt = promisify(scryptCallback);
const MAX_GUEST_HANDLE_LENGTH = 40;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VoteAnswerInput = { questionId: string; optionIds: string[] };

export type VoteInput = {
  eventId: string;
  answers: VoteAnswerInput[];
  guestHandle?: string;
  guestHandlePlatform?: "instagram" | "x";
};

export type VoteResult =
  | { ok: true; voteId: string }
  | {
      ok: false;
      reason:
        | "invalid"
        | "closed"
        | "locked"
        | "already-voted"
        | "unauthenticated"
        | "rate-limited"
        | "error";
      message: string;
    };

class VoteWindowClosedError extends Error {}

function describeError(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join("\n");
}

async function verifyPasscode(encoded: string, candidate: string) {
  const [algorithm, salt, expectedHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex || !/^[a-f0-9]+$/i.test(expectedHex)) {
    return false;
  }

  const expected = Buffer.from(expectedHex, "hex");
  const derived = (await scrypt(candidate, salt, expected.length)) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function unlockPrivateEvent(
  eventId: string,
  passcode: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!UUID_PATTERN.test(eventId) || passcode.length < 1 || passcode.length > 256) {
    return { ok: false, message: "Enter the passcode to continue." };
  }

  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event || event.visibility !== "passcode" || !event.passcodeHash) {
    return { ok: false, message: "This private poll is unavailable." };
  }
  const requestHeaders = await headers();
  if (!(await limitPasscodeAttempt(getClientIp(requestHeaders), eventId))) {
    return { ok: false, message: "Too many attempts. Please wait before trying again." };
  }
  if (!(await verifyPasscode(event.passcodeHash, passcode))) {
    return { ok: false, message: "That passcode didn’t match. Try again." };
  }

  const cookieStore = await cookies();
  let token = cookieStore.get(UNLOCK_COOKIE)?.value;
  if (!token) {
    token = randomBytes(32).toString("base64url");
    cookieStore.set(UNLOCK_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  await db
    .insert(eventPasscodeUnlocks)
    .values({
      eventId,
      unlockSessionTokenHash: hashUnlockToken(eventId, event.passcodeHash, token),
    })
    .onConflictDoNothing({
      target: [eventPasscodeUnlocks.eventId, eventPasscodeUnlocks.unlockSessionTokenHash],
    });

  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

export async function submitVote(input: VoteInput): Promise<VoteResult> {
  if (!UUID_PATTERN.test(input.eventId) || !Array.isArray(input.answers)) {
    return { ok: false, reason: "invalid", message: "Submit valid answers for this poll." };
  }
  if (input.answers.length < 1 || input.answers.length > 20) {
    return { ok: false, reason: "invalid", message: "Answer every question before submitting." };
  }
  if (input.answers.some((answer) =>
    !answer ||
    typeof answer.questionId !== "string" ||
    !UUID_PATTERN.test(answer.questionId) ||
    !Array.isArray(answer.optionIds) ||
    answer.optionIds.length < 1 ||
    answer.optionIds.length > 8 ||
    answer.optionIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))
  )) {
    return { ok: false, reason: "invalid", message: "One or more question answers are invalid." };
  }
  if (new Set(input.answers.map((answer) => answer.questionId)).size !== input.answers.length) {
    return { ok: false, reason: "invalid", message: "Answer each question only once." };
  }
  if (input.answers.some((answer) => new Set(answer.optionIds).size !== answer.optionIds.length)) {
    return { ok: false, reason: "invalid", message: "An option can only be selected once per question." };
  }

  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const userId = session?.user?.id ?? null;
  const ip = getClientIp(requestHeaders);
  if (!(await limitVoteByIp(ip))) {
    return { ok: false, reason: "rate-limited", message: "Please wait before trying again." };
  }
  if (userId && !(await limitVoteByIdentity(`user:${userId}`, input.eventId))) {
    return { ok: false, reason: "rate-limited", message: "Please wait before trying again." };
  }

  let guestToken: string | null = null;
  let guestHandle: string | null = null;
  let guestHandlePlatform: "instagram" | "x" | null = null;
  if (!userId) {
    guestHandle = input.guestHandle?.trim() ?? "";
    guestHandlePlatform = input.guestHandlePlatform ?? null;
    if (
      guestHandle.length < 1 ||
      guestHandle.length > MAX_GUEST_HANDLE_LENGTH ||
      (guestHandlePlatform !== "instagram" && guestHandlePlatform !== "x")
    ) {
      return {
        ok: false,
        reason: "invalid",
        message: "Enter a handle and select Instagram or X to vote as a guest.",
      };
    }

    const cookieStore = await cookies();
    guestToken = cookieStore.get(GUEST_COOKIE)?.value ?? null;
    if (!guestToken) {
      guestToken = randomBytes(32).toString("base64url");
      cookieStore.set(GUEST_COOKIE, guestToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    if (!(await limitVoteByIdentity(`guest:${guestToken}`, input.eventId))) {
      return { ok: false, reason: "rate-limited", message: "Please wait before trying again." };
    }
  }

  const unlockToken = (await cookies()).get(UNLOCK_COOKIE)?.value ?? null;

  try {
    const result = await db.transaction(async (tx): Promise<VoteResult> => {
      // Voters take a shared lock (FOR KEY SHARE) on the quiz, so ballots for
      // the same quiz do not serialize against each other.
      //
      // FOR KEY SHARE is used rather than FOR SHARE because the transaction
      // may itself UPDATE the quiz row (a scheduled quiz flipping to open),
      // and a NO KEY UPDATE conflicts with FOR SHARE. FOR KEY SHARE only
      // conflicts with FOR UPDATE, so it leaves that update possible while
      // still excluding the owner's exclusive close lock.
      //
      // The owner's close action takes FOR UPDATE, which conflicts with this
      // lock. A ballot therefore either commits before the close starts, or it
      // waits for the close to commit and is then rejected because the quiz is
      // no longer open. The deadline is enforced separately by the final
      // clock check before the transaction commits.
      const [event] = await tx
        .select()
        .from(events)
        .where(eq(events.id, input.eventId))
        .for("key share");
      if (!event) {
        return { ok: false, reason: "error", message: "This poll could not be found." };
      }

      const [{ dbNow }] = await tx
        .select({ dbNow: sql<string | Date>`clock_timestamp()` })
        .from(events)
        .where(eq(events.id, event.id));
      if (!isVoteWindowOpen(event, new Date(dbNow))) {
        return { ok: false, reason: "closed", message: "Voting is not open for this poll." };
      }

      if (event.visibility === "passcode" && event.passcodeHash) {
        const tokenHash = unlockToken
          ? hashUnlockToken(event.id, event.passcodeHash, unlockToken)
          : null;
        const [unlock] = tokenHash
          ? await tx
              .select({ id: eventPasscodeUnlocks.id })
              .from(eventPasscodeUnlocks)
              .where(
                and(
                  eq(eventPasscodeUnlocks.eventId, event.id),
                  eq(eventPasscodeUnlocks.unlockSessionTokenHash, tokenHash),
                ),
              )
          : [];
        if (!unlock) {
          return { ok: false, reason: "locked", message: "Unlock this poll before voting." };
        }
      }

      const questionRows = await tx
        .select({
          id: questions.id,
          pickType: questions.pickType,
          maxPicks: questions.maxPicks,
          optionId: options.id,
        })
        .from(questions)
        .leftJoin(options, eq(options.questionId, questions.id))
        .where(eq(questions.eventId, event.id));
      const questionRules = new Map<
        string,
        { pickType: "single" | "top_n"; maxPicks: number; optionIds: Set<string> }
      >();
      for (const row of questionRows) {
        const rule = questionRules.get(row.id) ?? {
          pickType: row.pickType,
          maxPicks: row.maxPicks,
          optionIds: new Set<string>(),
        };
        if (row.optionId) rule.optionIds.add(row.optionId);
        questionRules.set(row.id, rule);
      }

      if (questionRules.size < 1 || questionRules.size > 20 || input.answers.length !== questionRules.size) {
        return { ok: false, reason: "invalid", message: "Answer every required question." };
      }

      const allOptionIds: string[] = [];
      for (const answer of input.answers) {
        const rule = questionRules.get(answer.questionId);
        if (!rule || answer.optionIds.some((optionId) => !rule.optionIds.has(optionId))) {
          return {
            ok: false,
            reason: "invalid",
            message: "One or more answers do not belong to this question.",
          };
        }
        if (rule.pickType === "single" && answer.optionIds.length !== 1) {
          return { ok: false, reason: "invalid", message: "Pick one answer for each Pick one question." };
        }
        if (rule.pickType === "top_n" && answer.optionIds.length > rule.maxPicks) {
          return {
            ok: false,
            reason: "invalid",
            message: `Choose no more than ${rule.maxPicks} options for each Pick top N question.`,
          };
        }
        allOptionIds.push(...answer.optionIds);
      }

      const selectedOptions = await tx
        .select({ id: options.id, questionId: options.questionId })
        .from(options)
        .where(inArray(options.id, allOptionIds))
        .for("share");
      if (
        selectedOptions.length !== allOptionIds.length ||
        selectedOptions.some((option) =>
          !input.answers.some((answer) =>
            answer.questionId === option.questionId && answer.optionIds.includes(option.id),
          ),
        )
      ) {
        return {
          ok: false,
          reason: "invalid",
          message: "One or more selected options are no longer available for that question.",
        };
      }

      let guestSessionId: string | null = null;
      if (!userId && guestToken) {
        const tokenHash = hashGuestToken(event.id, guestToken);
        await tx
          .insert(voteGuestSessions)
          .values({ eventId: event.id, guestSessionTokenHash: tokenHash })
          .onConflictDoNothing({
            target: [voteGuestSessions.eventId, voteGuestSessions.guestSessionTokenHash],
          });
        const [guestSession] = await tx
          .select({ id: voteGuestSessions.id })
          .from(voteGuestSessions)
          .where(
            and(
              eq(voteGuestSessions.eventId, event.id),
              eq(voteGuestSessions.guestSessionTokenHash, tokenHash),
            ),
          );
        if (!guestSession) {
          return { ok: false, reason: "error", message: "Could not start a guest voting session." };
        }
        guestSessionId = guestSession.id;
      }

      const [ballot] = await tx
        .insert(votes)
        .values({
          eventId: event.id,
          voterUserId: userId,
          guestSessionId,
          guestHandle,
          guestHandlePlatform,
        })
        .returning({ id: votes.id });

      await tx.insert(ballotAnswers).values(
        input.answers.flatMap((answer) =>
          answer.optionIds.map((optionId, index) => ({
            voteId: ballot.id,
            eventId: event.id,
            questionId: answer.questionId,
            optionId,
            rankPosition: index + 1,
          })),
        ),
      );

      if (event.status === "scheduled") {
        await tx
          .update(events)
          .set({ status: "open", updatedAt: sql`clock_timestamp()` })
          .where(eq(events.id, event.id));
      }

      // A transaction that spans the deadline is rolled back rather than landing late.
      const [{ finalDbNow }] = await tx
        .select({ finalDbNow: sql<string | Date>`clock_timestamp()` })
        .from(events)
        .where(eq(events.id, event.id));
      if (event.closesAt <= new Date(finalDbNow)) throw new VoteWindowClosedError();

      return { ok: true, voteId: ballot.id };
    });

    if (!result.ok) return result;
    revalidatePath(`/events/${input.eventId}`);
    // Response counts are part of the Discover/home listing cache. Expire it
    // with a blocking revalidation so the next visit shows the new total
    // instead of a days-old stale-while-revalidate snapshot.
    revalidateTag("home:polls", { expire: 0 });
    revalidatePath("/");
    revalidatePath("/discover");
    return result;
  } catch (error) {
    const message = describeError(error);
    if (error instanceof VoteWindowClosedError) {
      return { ok: false, reason: "closed", message: "Voting is not open for this poll." };
    }
    if (
      message.includes("votes_logged_in_dedupe_unique") ||
      message.includes("votes_guest_dedupe_unique") ||
      message.includes("duplicate key")
    ) {
      return {
        ok: false,
        reason: "already-voted",
        message: "A response has already been submitted for this poll.",
      };
    }
    if (message.includes("Voting is not open")) {
      return { ok: false, reason: "closed", message: "Voting is not open for this poll." };
    }
    return {
      ok: false,
      reason: "error",
      message: "Couldn’t submit your answers. Your selections are still here; please try again.",
    };
  }
}
