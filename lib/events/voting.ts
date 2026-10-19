"use server";

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
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

  const event = await db.query.events.findFirst({ where: eq(events.id, input.eventId) });
  if (!event) return { ok: false, reason: "error", message: "This poll could not be found." };
  if (event.visibility === "passcode" && event.passcodeHash) {
    const token = (await cookies()).get(UNLOCK_COOKIE)?.value;
    const tokenHash = token
      ? hashUnlockToken(event.id, event.passcodeHash, token)
      : null;
    const unlocked = tokenHash
      ? await db.query.eventPasscodeUnlocks.findFirst({
          where: and(
            eq(eventPasscodeUnlocks.eventId, event.id),
            eq(eventPasscodeUnlocks.unlockSessionTokenHash, tokenHash),
          ),
        })
      : null;
    if (!unlocked) {
      return { ok: false, reason: "locked", message: "Unlock this poll before voting." };
    }
  }

  const now = new Date();
  const eventCanAcceptVotes =
    (event.status === "open" || event.status === "scheduled") &&
    event.opensAt <= now &&
    event.closesAt > now;
  if (!eventCanAcceptVotes) {
    return { ok: false, reason: "closed", message: "Voting is not open for this poll." };
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

  const selectedOptions = await db
    .select({ id: options.id })
    .from(options)
    .where(and(eq(options.eventId, event.id), inArray(options.id, input.optionIds)));
  if (selectedOptions.length !== input.optionIds.length) {
    return {
      ok: false,
      reason: "invalid",
      message: "One or more selected options are no longer available.",
    };
  }

  let guestSessionId: string | null = null;
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
    let token = cookieStore.get(GUEST_COOKIE)?.value;
    if (!token) {
      token = randomBytes(32).toString("base64url");
      cookieStore.set(GUEST_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }

    if (!(await limitVoteByIdentity(`guest:${token}`, event.id))) {
      return { ok: false, reason: "rate-limited", message: "Please wait before trying again." };
    }

    const tokenHash = hashGuestToken(event.id, token);
    await db
      .insert(voteGuestSessions)
      .values({ eventId: event.id, guestSessionTokenHash: tokenHash })
      .onConflictDoNothing({
        target: [voteGuestSessions.eventId, voteGuestSessions.guestSessionTokenHash],
      });
    const guestSession = await db.query.voteGuestSessions.findFirst({
      where: and(
        eq(voteGuestSessions.eventId, event.id),
        eq(voteGuestSessions.guestSessionTokenHash, tokenHash),
      ),
    });
    if (!guestSession) {
      return { ok: false, reason: "error", message: "Could not start a guest voting session." };
    }
    guestSessionId = guestSession.id;
  }

  try {
    const voteId = await db.transaction(async (tx) => {
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

        await tx
          .update(votes)
          .set({ isSubmitted: true })
          .where(eq(votes.id, ballot.id));
      }

      if (event.status === "scheduled") {
        await tx.update(events).set({ status: "open" }).where(eq(events.id, event.id));
      }

      return ballot.id;
    });

    revalidatePath(`/events/${event.id}`);
    return { ok: true, voteId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
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
