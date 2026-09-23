"use server";

import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { events, options } from "@/db/schema/app";

const scrypt = promisify(scryptCallback);

export type Visibility = "unlisted" | "discoverable" | "passcode";
export type SaveMode = "draft" | "publish";

export type OptionInput = {
  label: string;
  description: string;
  imageSource: "none" | "blob" | "external_url";
  imageUrl: string;
  imageBlobKey: string;
  imageAlt: string;
};

export type SaveEventInput = {
  eventId: string | null;
  saveAs: SaveMode;
  draftStep: number;
  title: string;
  description: string;
  opensAt: string;
  closesAt: string;
  visibility: Visibility;
  passcode: string;
  options: OptionInput[];
};

export type SaveEventResult =
  | { ok: true; eventId: string; status: string }
  | { ok: false; errors: Record<string, string>; formError: string | null };

async function requireUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
}

async function hashPasscode(code: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(code, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

function isBlankOption(o: OptionInput) {
  return (
    o.label.trim() === "" &&
    o.description.trim() === "" &&
    o.imageUrl.trim() === "" &&
    o.imageBlobKey.trim() === ""
  );
}

function validHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateOptions(list: OptionInput[], strict: boolean) {
  const errors: Record<string, string> = {};
  const kept = list.filter((o) => !isBlankOption(o));

  if (strict && kept.length < 2) {
    errors.options = "Add at least two options before publishing.";
  }
  if (kept.length > 8) {
    errors.options = "A poll can have at most eight options.";
  }

  kept.forEach((o, i) => {
    if (o.label.trim().length === 0) {
      errors[`option-${i}-label`] = "Give this option a label, or clear the row.";
    } else if (o.label.trim().length > 120) {
      errors[`option-${i}-label`] = "Keep labels to 120 characters or fewer.";
    }
    if (o.description.trim().length > 1000) {
      errors[`option-${i}-description`] =
        "Keep descriptions to 1000 characters or fewer.";
    }
    if (o.imageSource === "external_url") {
      if (!validHttpUrl(o.imageUrl)) {
        errors[`option-${i}-image`] = "Paste a valid http(s) image URL.";
      }
    }
    if (o.imageSource === "blob") {
      if (!validHttpUrl(o.imageUrl) || o.imageBlobKey.trim() === "") {
        errors[`option-${i}-image`] =
          "This upload looks incomplete — try uploading again.";
      }
    }
    if (o.imageAlt.trim().length > 180) {
      errors[`option-${i}-imageAlt`] = "Keep alt text to 180 characters or fewer.";
    }
  });

  return { errors, kept };
}

export async function saveEvent(input: SaveEventInput): Promise<SaveEventResult> {
  const userId = await requireUserId();
  if (!userId) {
    return { ok: false, errors: {}, formError: "Sign in to save this poll." };
  }

  const strict = input.saveAs === "publish";
  const errors: Record<string, string> = {};

  const title = input.title.trim();
  const description = input.description.trim();
  const visibility: Visibility = ["unlisted", "discoverable", "passcode"].includes(
    input.visibility,
  )
    ? input.visibility
    : "unlisted";
  const draftStep = [1, 2, 3].includes(input.draftStep) ? input.draftStep : 1;

  let opensAt: Date | null = null;
  let closesAt: Date | null = null;
  if (input.opensAt.trim() !== "") {
    const parsed = new Date(input.opensAt);
    if (!Number.isNaN(parsed.getTime())) opensAt = parsed;
  }
  if (input.closesAt.trim() !== "") {
    const parsed = new Date(input.closesAt);
    if (!Number.isNaN(parsed.getTime())) closesAt = parsed;
  }

  if (strict) {
    if (title.length === 0) errors.title = "Give your poll a title.";
    else if (title.length > 160) errors.title = "Keep titles to 160 characters or fewer.";
    if (!opensAt) errors.opensAt = "Choose when voting opens.";
    if (!closesAt) errors.closesAt = "Choose when voting closes.";
    if (opensAt && closesAt && closesAt <= opensAt) {
      errors.closesAt = "Closing time must be after opening time.";
    }
    if (visibility === "passcode") {
      if (input.passcode.length < 4) {
        errors.passcode = "Set a passcode of at least 4 characters.";
      }
    }
  }

  const { errors: optionErrors, kept } = validateOptions(input.options, strict);
  Object.assign(errors, optionErrors);

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, formError: null };
  }

  let existing: typeof events.$inferSelect | undefined;
  if (input.eventId) {
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
  }

  const now = new Date();
  const finalOpens = opensAt ?? existing?.opensAt ?? now;
  const fallbackClose = new Date((opensAt ?? now).getTime() + 7 * 24 * 60 * 60 * 1000);
  const finalCloses = closesAt ?? existing?.closesAt ?? fallbackClose;

  let passcodeHash: string | null = existing?.passcodeHash ?? null;
  if (visibility === "passcode") {
    passcodeHash =
      input.passcode.length >= 4 ? await hashPasscode(input.passcode) : passcodeHash;
    if (!passcodeHash) {
      return {
        ok: false,
        errors: { passcode: "Set a passcode of at least 4 characters." },
        formError: null,
      };
    }
  } else {
    passcodeHash = null;
  }

  const status =
    input.saveAs === "publish" ? (finalOpens <= now ? "open" : "scheduled") : "draft";

  const eventId = await db.transaction(async (tx) => {
    let id = input.eventId;
    if (id) {
      await tx
        .update(events)
        .set({
          title: title === "" ? "Untitled poll" : title,
          description: description === "" ? null : description,
          status,
          visibility,
          passcodeHash,
          opensAt: finalOpens,
          closesAt: finalCloses,
          draftStep: input.saveAs === "publish" ? null : draftStep,
          updatedAt: now,
        })
        .where(eq(events.id, id));
      await tx.delete(options).where(eq(options.eventId, id));
    } else {
      const [created] = await tx
        .insert(events)
        .values({
          creatorUserId: userId,
          title: title === "" ? "Untitled poll" : title,
          description: description === "" ? null : description,
          status,
          visibility,
          passcodeHash,
          opensAt: finalOpens,
          closesAt: finalCloses,
          draftStep: input.saveAs === "publish" ? null : draftStep,
        })
        .returning({ id: events.id });
      id = created.id;
    }

    for (let i = 0; i < kept.length; i++) {
      const o = kept[i];
      await tx.insert(options).values({
        eventId: id,
        label: o.label.trim() === "" ? "Untitled option" : o.label.trim(),
        description: o.description.trim() === "" ? null : o.description.trim(),
        imageSource:
          o.imageSource === "none"
            ? null
            : (o.imageSource as "blob" | "external_url"),
        imageUrl: o.imageUrl.trim() === "" ? null : o.imageUrl.trim(),
        imageBlobKey: o.imageBlobKey.trim() === "" ? null : o.imageBlobKey.trim(),
        imageAlt: o.imageAlt.trim() === "" ? null : o.imageAlt.trim(),
        sortOrder: i,
      });
    }

    return id;
  });

  revalidatePath("/events/drafts");
  return { ok: true, eventId, status };
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
