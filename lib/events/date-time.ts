const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Formats an absolute instant as the browser's local datetime-local value. */
export function utcInstantToLocalInput(value: string): string | null {
  const instant = parseUtcInstant(value);
  if (!instant) return null;

  return [
    `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`,
    `T${pad(instant.getHours())}:${pad(instant.getMinutes())}`,
  ].join("");
}

/** Converts a browser-local datetime-local value into an explicit UTC instant. */
export function localInputToUtcIso(value: string): string | null {
  const localValue = value.trim();
  if (!LOCAL_DATE_TIME_PATTERN.test(localValue)) return null;

  const instant = new Date(localValue);
  if (Number.isNaN(instant.getTime())) return null;

  // Reject local wall times that the browser normalized (for example, a time
  // inside a daylight-saving gap) instead of silently changing the selection.
  const roundTrip = [
    `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`,
    `T${pad(instant.getHours())}:${pad(instant.getMinutes())}`,
  ].join("");
  if (roundTrip !== localValue) return null;

  return instant.toISOString();
}

/** Parses only an explicit ISO instant; a server-local datetime is rejected. */
export function parseUtcInstant(value: string): Date | null {
  const instant = value.trim();
  if (!ISO_INSTANT_PATTERN.test(instant)) return null;
  const parsed = new Date(instant);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
