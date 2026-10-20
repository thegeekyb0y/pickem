"use server";

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
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
  eventPasscodeUnlocks,
  events,
  options,
  voteGuestSessions,
  votePicks,
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

export type VoteInput = {
  eventId: string;
  optionIds: string[];
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
  if (!UUID_PATTERN.test(input.eventId) || !Array.isArray(input.optionIds)) {
    return { ok: false, reason: "invalid", message: "Choose a valid option." };
  }
  if (input.optionIds.length < 1 || input.optionIds.length > 8) {
    return { ok: false, reason: "invalid", message: "Choose between one and eight options." };
  }
  if (input.optionIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
    return { ok: false, reason: "invalid", message: "One or more selected options are invalid." };
  }
  if (new Set(input.optionIds).size !== input.optionIds.length) {
    return { ok: false, reason: "invalid", message: "An option can only be selected once." };
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
      // Voters take a shared lock (FOR KEY SHARE) on the poll, so ballots for
      // the same poll do not serialize against each other.
      //
      // FOR KEY SHARE is used rather than FOR SHARE because the transaction
      // may itself UPDATE the poll row (a scheduled poll flipping to open),
      // and a NO KEY UPDATE conflicts with FOR SHARE. FOR KEY SHARE only
      // conflicts with FOR UPDATE, so it leaves that update possible while
      // still excluding the owner's exclusive close lock.
      //
      // The owner's close action takes FOR UPDATE, which conflicts with this
      // lock. A ballot therefore either commits before the close starts, or it
      // waits for the close to commit and is then rejected because the poll is
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

      if (event.pickType === "single" && input.optionIds.length !== 1) {
        return { ok: false, reason: "invalid", message: "Choose exactly one option." };
      }
      if (event.pickType === "top_n" && input.optionIds.length > event.maxPicks) {
        return {
          ok: false,
          reason: "invalid",
          message: `Choose no more than ${event.maxPicks} options, in order.`,
        };
      }

      const selectedOptions = await tx
        .select({ id: options.id })
        .from(options)
        .where(and(eq(options.eventId, event.id), inArray(options.id, input.optionIds)))
        .for("share");
      if (selectedOptions.length !== input.optionIds.length) {
        return {
          ok: false,
          reason: "invalid",
          message: "One or more selected options are no longer available.",
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
          optionId: event.pickType === "single" ? input.optionIds[0] : null,
          voterUserId: userId,
          guestSessionId,
          guestHandle,
          guestHandlePlatform,
          isSubmitted: event.pickType === "single",
        })
        .returning({ id: votes.id });

      if (event.pickType === "top_n") {
        await tx.insert(votePicks).values(
          input.optionIds.map((optionId, index) => ({
            voteId: ballot.id,
            eventId: event.id,
            optionId,
            rankPosition: index + 1,
          })),
        );
        await tx.update(votes).set({ isSubmitted: true }).where(eq(votes.id, ballot.id));
      }

      if (event.status === "scheduled") {
        await tx.update(events).set({ status: "open" }).where(eq(events.id, event.id));
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
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
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
        message: "A ballot has already been submitted for this poll.",
      };
    }
    if (message.includes("Voting is not open")) {
      return { ok: false, reason: "closed", message: "Voting is not open for this poll." };
    }
    return {
      ok: false,
      reason: "error",
      message: "Couldn’t submit your ballot. Your selections are still here; please try again.",
    };
  }
}
