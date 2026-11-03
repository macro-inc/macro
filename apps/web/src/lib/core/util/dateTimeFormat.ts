// Date helpers run once per visible row. Reuse the expensive ICU formatter,
// while bounding the cache for callers that supply arbitrary time zones.
const formatters = new Map<string, Intl.DateTimeFormat>();

export function dateTimeFormatter(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  // An implicit zone belongs to the current system setting, not the lifetime
  // of the first formatter. Resolve it before both lookup and construction.
  const timeZone =
    options.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const resolvedOptions = { ...options, timeZone };
  const key = JSON.stringify([locale, resolvedOptions]);
  const existing = formatters.get(key);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat(locale, resolvedOptions);
  if (formatters.size >= 64) formatters.clear();
  formatters.set(key, formatter);
  return formatter;
}

/** Keep Date.toLocaleString's invalid-date behavior. */
export function formatIntlDate(
  date: Date,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions
): string {
  if (Number.isNaN(date.getTime())) return 'Invalid Date';
  return dateTimeFormatter(locale, options).format(date);
}
