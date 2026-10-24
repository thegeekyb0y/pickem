/** Extracts the first pasted image file from a paste/DataTransfer payload. */
export function imageFileFromDataTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

export function imageFileExtension(type: string) {
  const subtype = type.split("/")[1]?.split("+")[0];
  if (!subtype) return "png";
  return subtype === "jpeg" ? "jpg" : subtype;
}

/**
 * Reads an image from the async clipboard. Throws when the browser blocks
 * access, so callers can fall back to a paste hint.
 */
export async function imageFileFromClipboard(): Promise<File | null> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) return null;
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((candidate) => candidate.startsWith("image/"));
    if (!type) continue;
    const blob = await item.getType(type);
    return new File([blob], `pasted-image.${imageFileExtension(type)}`, { type });
  }
  return null;
}
