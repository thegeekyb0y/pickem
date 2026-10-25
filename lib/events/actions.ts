"use server";

import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { headers } from "next/headers";
import { revalidatePath, revalidateTag } from "next/cache";
import { put } from "@vercel/blob";
import sharp from "sharp";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  events,
  options,
  questions,
  type QuizCoverKind,
  type QuizCoverMeta,
} from "@/db/schema/app";
import { parseUtcInstant } from "@/lib/events/date-time";
import { validateEventSlug } from "@/lib/events/slug";
import { getQuizCoverPreset } from "@/lib/quiz/cover-presets";
import { validateQuizQuestions, type QuizOptionInput } from "@/lib/events/quiz-validation";
import { limitQuizCoverUpload } from "@/lib/rate-limit";

const scrypt = promisify(scryptCallback);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Visibility = "unlisted" | "discoverable" | "passcode";
export type SaveMode = "draft" | "publish";
export type OptionInput = QuizOptionInput;

export type SaveQuizInput = {
  eventId: string | null;
  expectedDraftVersion: number | null;
  saveAs: SaveMode;
  draftStep: number;
  title: string;
  description: string;
  slug: string;
  opensAt: string;
  closesAt: string;
  visibility: Visibility;
  passcode: string;
  coverKind: QuizCoverKind;
  coverRef: string | null;
  coverMeta: QuizCoverMeta | null;
  questions: ReturnType<typeof validateQuizQuestions>["questions"];
};

export type SaveQuizResult =
  | {
      ok: true;
      eventId: string;
      status: string;
      draftVersion: number;
      hasPasscode: boolean;
      slug: string | null;
    }
  | { ok: false; errors: Record<string, string>; formError: string | null };

type SaveQuizTransactionResult =
  | Extract<SaveQuizResult, { ok: true }>
  | { ok: false; reason: "unavailable" }
  | { ok: false; reason: "conflict"; version: number };

export type OwnerActionResult =
  | { ok: true }
  | { ok: false; message: string };

async function requireUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
}

async function hashPasscode(code: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(code, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

/** Walks Drizzle's wrapped error chain for Postgres' unique-violation code. */
function isUniqueViolation(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === "23505") return true;
    current = candidate.cause;
  }
  return false;
}

function normalizeCover(
  kind: QuizCoverKind,
  rawRef: unknown,
  rawMeta: unknown,
): { coverRef: string | null; coverMeta: QuizCoverMeta | null } | null {
  if (!(["preset", "unsplash", "upload", "none"] as string[]).includes(kind)) {
    return null;
  }
  if (kind === "none") {
    return rawRef == null ? { coverRef: null, coverMeta: null } : null;
  }
  if (typeof rawRef !== "string" || rawRef.trim() === "") return null;

  if (kind === "preset") {
    return getQuizCoverPreset(rawRef)
      ? { coverRef: rawRef, coverMeta: null }
      : null;
  }

  if (!rawMeta || typeof rawMeta !== "object") return null;
  const input = rawMeta as Record<string, unknown>;
  const focalPoint = input.focalPoint;
  const normalizedFocalPoint =
    focalPoint &&
    typeof focalPoint === "object" &&
    Number.isFinite((focalPoint as { x?: unknown }).x) &&
    Number.isFinite((focalPoint as { y?: unknown }).y)
      ? {
          x: Math.max(0, Math.min(1, Number((focalPoint as { x: number }).x))),
          y: Math.max(0, Math.min(1, Number((focalPoint as { y: number }).y))),
        }
      : undefined;

  if (kind === "unsplash") {
    let imageUrl: URL;
    try {
      imageUrl = new URL(rawRef);
    } catch {
      return null;
    }
    const isAllowedImage = imageUrl.protocol === "https:" && imageUrl.hostname === "images.unsplash.com";
    const photoId = typeof input.photoId === "string" ? input.photoId.slice(0, 160) : "";
    const photographer = typeof input.photographer === "string" ? input.photographer.slice(0, 120) : "";
    const photographerUrl = typeof input.photographerUrl === "string" ? input.photographerUrl : "";
    const photoUrl = typeof input.photoUrl === "string" ? input.photoUrl : "";
    const downloadLocation = typeof input.downloadLocation === "string" ? input.downloadLocation : "";
    try {
      if (
        !isAllowedImage ||
        !photoId ||
        !photographer ||
        new URL(photographerUrl).hostname !== "unsplash.com" ||
        new URL(photoUrl).hostname !== "unsplash.com" ||
        new URL(downloadLocation).hostname !== "api.unsplash.com"
      ) return null;
    } catch {
      return null;
    }
    return {
      coverRef: imageUrl.toString(),
      coverMeta: {
        photoId,
        photographer,
        photographerUrl,
        photoUrl,
        downloadLocation,
        dominantColor: typeof input.dominantColor === "string" ? input.dominantColor.slice(0, 40) : undefined,
        focalPoint: normalizedFocalPoint,
      },
    };
  }

  let uploadUrl: URL;
  try {
    uploadUrl = new URL(rawRef);
  } catch {
    return null;
  }
  if (
    uploadUrl.protocol !== "https:" ||
    !uploadUrl.hostname.endsWith(".public.blob.vercel-storage.com")
  ) return null;
  return {
    coverRef: uploadUrl.toString(),
    coverMeta: { focalPoint: normalizedFocalPoint },
  };
}

export async function saveQuiz(input: SaveQuizInput): Promise<SaveQuizResult> {
  if (
    !input ||
    typeof input !== "object" ||
    typeof input.title !== "string" ||
    typeof input.description !== "string" ||
    typeof input.opensAt !== "string" ||
    typeof input.closesAt !== "string" ||
    typeof input.passcode !== "string" ||
    typeof input.slug !== "string" ||
    !Array.isArray(input.questions) ||
    typeof input.coverKind !== "string" ||
    (input.coverRef !== null && typeof input.coverRef !== "string")
  ) {
    return {
      ok: false,
      errors: {},
      formError: "Some poll details were invalid. Review the fields and try again.",
    };
  }

  const userId = await requireUserId();
  if (!userId) {
    return { ok: false, errors: {}, formError: "Sign in to save this poll." };
  }

  if (input.saveAs !== "draft" && input.saveAs !== "publish") {
    return { ok: false, errors: {}, formError: "Choose whether to save or publish this poll." };
  }
  const strict = input.saveAs === "publish";
  const errors: Record<string, string> = {};

  const title = input.title.trim();
  const description = input.description.trim();
  let slug: string | null = null;
  if (input.slug.trim() !== "") {
    const slugCheck = validateEventSlug(input.slug);
    if (!slugCheck.ok) errors.slug = slugCheck.message;
    else slug = slugCheck.slug;
  }
  if (!["unlisted", "discoverable", "passcode"].includes(input.visibility)) {
    errors.visibility = "Choose a valid poll visibility.";
  }
  const visibility = input.visibility as Visibility;
  const draftStep = [1, 2, 3].includes(input.draftStep) ? input.draftStep : 1;
  const normalizedCover = normalizeCover(input.coverKind, input.coverRef, input.coverMeta);
  if (!normalizedCover) errors.cover = "Choose a valid poll cover.";
  const { errors: questionErrors, questions: normalizedQuestions } = validateQuizQuestions(
    input.questions,
    strict,
  );
  Object.assign(errors, questionErrors);

  let opensAt: Date | null = null;
  let closesAt: Date | null = null;
  if (input.opensAt.trim() !== "") {
    opensAt = parseUtcInstant(input.opensAt);
    if (!opensAt) errors.opensAt = "Choose a valid date and time.";
  }
  if (input.closesAt.trim() !== "") {
    closesAt = parseUtcInstant(input.closesAt);
    if (!closesAt) errors.closesAt = "Choose a valid date and time.";
  }

  if (strict) {
    if (title.length === 0) errors.title = "Give your poll a title.";
    else if (title.length > 160) errors.title = "Keep titles to 160 characters or fewer.";
    if (!opensAt) errors.opensAt = "Choose when voting opens.";
    if (!closesAt) errors.closesAt = "Choose when voting closes.";
  }
  if (title.length > 160) errors.title = "Keep titles to 160 characters or fewer.";
  if (opensAt && closesAt && closesAt <= opensAt) {
    errors.closesAt = "Closing time must be after opening time.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, formError: null };
  }

  let existing: typeof events.$inferSelect | undefined;
  if (input.eventId) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.eventId,
      )
    ) {
      return {
        ok: false,
        errors: {},
        formError: "This draft isn’t available — it may have been published or removed.",
      };
    }
    existing = await db.query.events.findFirst({
      where: eq(events.id, input.eventId),
    });
    if (!existing || existing.creatorUserId !== userId || existing.status !== "draft") {
      return {
        ok: false,
        errors: {},
        formError: "This draft isn’t available — it may have been published or removed.",
      };
    }
    if (
      !Number.isInteger(input.expectedDraftVersion) ||
      input.expectedDraftVersion !== existing.draftVersion
    ) {
      return {
        ok: false,
        errors: {},
        formError: "This draft changed in another tab. Reload it before saving again.",
      };
    }
  } else if (input.expectedDraftVersion !== null) {
    return { ok: false, errors: {}, formError: "This new poll has an invalid draft version." };
  }

  if (slug && (!existing || existing.slug !== slug)) {
    const [owner] = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.slug, slug))
      .limit(1);
    if (owner) {
      return {
        ok: false,
        errors: { slug: "That link is already taken." },
        formError: null,
      };
    }
  }

  const now = new Date();
  const finalOpens = opensAt ?? existing?.opensAt ?? now;
  const fallbackClose = new Date((opensAt ?? now).getTime() + 7 * 24 * 60 * 60 * 1000);
  const finalCloses = closesAt ?? existing?.closesAt ?? fallbackClose;

  let passcodeHash: string | null = existing?.passcodeHash ?? null;
  if (visibility === "passcode") {
    passcodeHash =
      input.passcode.length >= 4 ? await hashPasscode(input.passcode) : passcodeHash;
    if (!passcodeHash) errors.passcode = "Set a passcode of at least 4 characters.";
  } else {
    passcodeHash = null;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors, formError: null };

  const status =
    input.saveAs === "publish" ? (finalOpens <= now ? "open" : "scheduled") : "draft";

  let transactionResult: SaveQuizTransactionResult;
  try {
    transactionResult = await db.transaction(async (tx) => {
      let id = input.eventId;
      let draftVersion = 1;
      if (id) {
        const [locked] = await tx
          .select()
          .from(events)
          .where(and(eq(events.id, id), eq(events.creatorUserId, userId)))
          .for("update");
        if (!locked || locked.status !== "draft") {
          return { ok: false as const, reason: "unavailable" as const };
        }
        if (locked.draftVersion !== input.expectedDraftVersion) {
          return { ok: false as const, reason: "conflict" as const, version: locked.draftVersion };
        }
        draftVersion = locked.draftVersion + 1;
        await tx
          .update(events)
          .set({
            title: title === "" ? "Untitled poll" : title,
            description: description === "" ? null : description,
            slug,
            status,
            visibility,
            passcodeHash,
            opensAt: finalOpens,
            closesAt: finalCloses,
            draftStep: input.saveAs === "publish" ? null : draftStep,
            draftVersion,
            coverKind: input.coverKind,
            coverRef: normalizedCover!.coverRef,
            coverMeta: normalizedCover!.coverMeta,
            // `created_at` comes from the database clock, so `updated_at` must
            // too: mixing app time with DB time can violate
            // `events_updated_after_created_chk` whenever the two clocks drift.
            updatedAt: sql`clock_timestamp()`,
          })
          .where(and(eq(events.id, id), eq(events.draftVersion, locked.draftVersion)));
        await tx.delete(questions).where(eq(questions.eventId, id));
      } else {
        const [created] = await tx
          .insert(events)
          .values({
            creatorUserId: userId,
            title: title === "" ? "Untitled poll" : title,
            description: description === "" ? null : description,
            slug,
            status,
            visibility,
            passcodeHash,
            opensAt: finalOpens,
            closesAt: finalCloses,
            draftStep: input.saveAs === "publish" ? null : draftStep,
            draftVersion,
            coverKind: input.coverKind,
            coverRef: normalizedCover!.coverRef,
            coverMeta: normalizedCover!.coverMeta,
          })
          .returning({ id: events.id, draftVersion: events.draftVersion });
        id = created.id;
        draftVersion = created.draftVersion;
      }

      const questionIds = normalizedQuestions.map(() => randomUUID());
      await tx.insert(questions).values(
        normalizedQuestions.map((question, index) => ({
          id: questionIds[index],
          eventId: id!,
          prompt: question.prompt,
          description: question.description || null,
          pickType: question.pickType,
          maxPicks: question.maxPicks,
          sortOrder: index,
        })),
      );

      const optionValues = normalizedQuestions.flatMap((question, questionIndex) =>
        question.options.map((option, sortOrder) => ({
          questionId: questionIds[questionIndex],
          label: option.label.trim() || "Untitled option",
          description: option.description.trim() || null,
          imageSource: option.imageSource === "none" ? null : option.imageSource,
          imageUrl: option.imageUrl.trim() || null,
          imageBlobKey: option.imageBlobKey.trim() || null,
          imageAlt: option.imageAlt.trim() || null,
          sortOrder,
        })),
      );
      if (optionValues.length > 0) {
        await tx.insert(options).values(optionValues);
      }

      return {
        ok: true as const,
        eventId: id!,
        status,
        draftVersion,
        hasPasscode: Boolean(passcodeHash),
        slug,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        errors: { slug: "That link is already taken. Choose another one." },
        formError: null,
      };
    }
    const cause = error instanceof Error ? error.cause : undefined;
    console.error("saveQuiz transaction failed", {
      saveAs: input.saveAs,
      eventId: input.eventId,
      message: cause instanceof Error ? cause.message : "Unexpected server error",
    });
    return {
      ok: false,
      errors: {},
      formError:
        input.saveAs === "publish"
          ? "Couldn’t publish. Your edits are still here. Try again."
          : "Couldn’t save this draft. Your edits are still here. Try again.",
    };
  }

  if (!transactionResult.ok) {
    return transactionResult.reason === "conflict"
      ? {
          ok: false,
          errors: {},
          formError: `This draft changed in another tab (version ${transactionResult.version}). Reload it before saving again.`,
        }
      : {
          ok: false,
          errors: {},
          formError: "This draft isn’t available — it may have been published or removed.",
        };
  }

  revalidatePath("/events/drafts");
  revalidatePath("/profile");
  if (input.saveAs === "publish") {
    revalidateTag("home:polls", "max");
    revalidatePath("/discover");
  }
  revalidatePath(`/events/${transactionResult.eventId}`);
  return { ...transactionResult };
}

export async function closeEvent(eventId: string): Promise<OwnerActionResult> {
  if (!UUID_PATTERN.test(eventId)) {
    return { ok: false, message: "This poll is unavailable." };
  }

  const userId = await requireUserId();
  if (!userId) return { ok: false, message: "Sign in to manage this poll." };

  const closed = await db.transaction(async (tx) => {
    const [event] = await tx
      .select({
        id: events.id,
        creatorUserId: events.creatorUserId,
        status: events.status,
        opensAt: events.opensAt,
        closesAt: events.closesAt,
      })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.creatorUserId, userId)))
      .for("update");
    if (!event) return false;

    const [{ now }] = await tx
      .select({ now: sql<string | Date>`clock_timestamp()` })
      .from(events)
      .where(eq(events.id, event.id));
    const closedAt = new Date(now);
    if (
      event.status === "draft" ||
      event.status === "cancelled" ||
      event.status === "closed" ||
      event.opensAt > closedAt ||
      event.closesAt <= closedAt
    ) {
      return false;
    }

    await tx
      .update(events)
      .set({ status: "closed", closesAt: closedAt, updatedAt: closedAt })
      .where(eq(events.id, event.id));
    return true;
  });

  if (!closed) return { ok: false, message: "Only an open poll can be closed early." };
  revalidateTag("home:polls", "max");
  revalidatePath("/");
  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

export async function deleteDraft(eventId: string): Promise<OwnerActionResult> {
  if (!UUID_PATTERN.test(eventId)) {
    return { ok: false, message: "This draft is unavailable." };
  }

  const userId = await requireUserId();
  if (!userId) return { ok: false, message: "Sign in to delete this draft." };

  const [deleted] = await db
    .delete(events)
    .where(
      and(
        eq(events.id, eventId),
        eq(events.creatorUserId, userId),
        eq(events.status, "draft"),
      ),
    )
    .returning({ id: events.id });

  if (!deleted) return { ok: false, message: "Only your own draft can be deleted." };
  revalidateTag("home:polls", "max");
  revalidatePath("/");
  revalidatePath("/events/drafts");
  return { ok: true };
}

export async function updateProfileName(
  rawName: unknown,
): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  if (typeof rawName !== "string") {
    return { ok: false, message: "Enter a valid display name." };
  }
  const name = rawName.trim();
  if (name.length < 1 || name.length > 80) {
    return { ok: false, message: "Keep your display name between 1 and 80 characters." };
  }

  const userId = await requireUserId();
  if (!userId) return { ok: false, message: "Sign in to update your profile." };

  try {
    await auth.api.updateUser({
      headers: await headers(),
      body: { name },
    });
    revalidatePath("/profile");
    return { ok: true, name };
  } catch {
    return { ok: false, message: "Couldn’t update your display name. Try again." };
  }
}

export type UploadResult =
  | { ok: true; url: string; key: string }
  | { ok: false; error: string };

export async function uploadOptionImage(formData: FormData): Promise<UploadResult> {
  const userId = await requireUserId();
  if (!userId) {
    return { ok: false, error: "Sign in to upload images." };
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { ok: false, error: "Uploads aren’t configured yet — paste a URL instead." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image file first." };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "Only image files are allowed." };
  }
  if (file.size > 4 * 1024 * 1024) {
    return { ok: false, error: "Keep images under 4 MB." };
  }

  try {
    const blob = await put(`poll-options/${Date.now()}-${file.name}`, file, {
      access: "public",
      contentType: file.type,
    });
    const key = new URL(blob.url).pathname.replace(/^\//, "");
    return { ok: true, url: blob.url, key };
  } catch {
    return { ok: false, error: "Upload failed — try again or paste a URL." };
  }
}

export type QuizCoverUploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function uploadQuizCover(formData: FormData): Promise<QuizCoverUploadResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Sign in to upload a poll cover." };
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { ok: false, error: "Poll cover uploads aren’t configured yet." };
  }
  if (!(await limitQuizCoverUpload(userId))) {
    return { ok: false, error: "Too many cover uploads. Try again later." };
  }

  const file = formData.get("file");
  const acceptedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!(file instanceof File) || file.size === 0 || !acceptedTypes.has(file.type)) {
    return { ok: false, error: "Choose a PNG, JPEG, or WebP image." };
  }
  if (file.size > 12 * 1024 * 1024) {
    return { ok: false, error: "Keep the original image under 12 MB." };
  }

  try {
    const source = Buffer.from(await file.arrayBuffer());
    const input = sharp(source, { limitInputPixels: 50_000_000 });
    const metadata = await input.metadata();
    if (!metadata.width || !metadata.height || !["png", "jpeg", "webp"].includes(metadata.format ?? "")) {
      return { ok: false, error: "This image file could not be processed." };
    }

    // Re-encoding through Sharp applies EXIF orientation, strips metadata, and
    // produces a responsive web format before the image reaches public Blob.
    const webp = await sharp(source, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 2400, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    if (webp.byteLength > 4 * 1024 * 1024) {
      return { ok: false, error: "The optimized cover is too large. Choose a smaller image." };
    }

    const blob = await put(`quiz-covers/${randomUUID()}.webp`, webp, {
      access: "public",
      contentType: "image/webp",
    });
    return { ok: true, url: blob.url };
  } catch {
    return { ok: false, error: "The image could not be processed. Try a different file." };
  }
}
