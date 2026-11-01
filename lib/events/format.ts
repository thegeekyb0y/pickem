/**
 * Date/time options shared by poll surfaces so the Discover card and the poll
 * page print the same shape. `timeZoneName` stays visible because a viewer can
 * be in a different zone from whoever created the poll.
 */
export const pollDateTimeOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
} satisfies Intl.DateTimeFormatOptions;

export type PollDateTimeFormatOptions = {
  locale?: string;
  timeZone?: string;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor({
  locale,
  timeZone,
}: PollDateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ""}|${timeZone ?? ""}`;
  const cached = formatters.get(key);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat(locale, {
    ...pollDateTimeOptions,
    timeZone,
  });
  formatters.set(key, formatter);
  return formatter;
}

/**
 * Formats an instant in the runtime's locale and timezone by default. On the
 * server that means the host timezone, in the browser the viewer's. Passing a
 * locale or zone explicitly is only needed by tests.
 */
export function formatPollDateTime(
  value: Date,
  options: PollDateTimeFormatOptions = {},
): string {
  return formatterFor(options).format(value);
}
