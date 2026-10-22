const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;

/** Formats an absolute instant as a datetime-local value in the requested zone. */
export function utcInstantToLocalInput(
  value: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string | null {
  const instant = parseUtcInstant(value);
  if (!instant) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** Converts a browser-local datetime-local value into an explicit UTC instant. */
export function localInputToUtcIso(value: string): string | null {
  const localValue = value.trim();
  if (!LOCAL_DATE_TIME_PATTERN.test(localValue)) return null;

  const instant = new Date(localValue);
  if (Number.isNaN(instant.getTime())) return null;

  // Reject local wall times that the browser normalized (for example, a time
  // inside a daylight-saving gap) instead of silently changing the selection.
  const roundTrip = utcInstantToLocalInput(
    instant.toISOString(),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
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
