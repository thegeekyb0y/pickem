import "server-only";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { eventPasscodeUnlocks } from "@/db/schema/app";

const UNLOCK_COOKIE = "pickem_private_unlock";
export const GUEST_COOKIE = "pickem_guest_session";

export function hashGuestToken(eventId: string, token: string) {
  return createHash("sha256").update(`${eventId}:${token}`).digest("hex");
}

function hashUnlockToken(eventId: string, passcodeHash: string, token: string) {
  return createHash("sha256")
    .update(`${eventId}:${passcodeHash}:${token}`)
    .digest("hex");
}

export async function hasEventUnlock(eventId: string, passcodeHash: string) {
  const token = (await cookies()).get(UNLOCK_COOKIE)?.value;
  if (!token) return false;

  const tokenHash = hashUnlockToken(eventId, passcodeHash, token);
  const row = await db.query.eventPasscodeUnlocks.findFirst({
    where: and(
      eq(eventPasscodeUnlocks.eventId, eventId),
      eq(eventPasscodeUnlocks.unlockSessionTokenHash, tokenHash),
    ),
  });
  return row != null;
}

export { hashUnlockToken, UNLOCK_COOKIE };
