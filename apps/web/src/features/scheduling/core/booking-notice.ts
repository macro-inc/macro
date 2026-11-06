/** Format whole notice minutes without fractional hours or days. */
export function formatBookingNotice(minutes: number): string {
  if (!Number.isFinite(minutes)) return '';
  // Keep invalid stored values visible until the owner corrects them.
  if (!Number.isInteger(minutes) || minutes < 0) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours
    ? `${hours} h${remainder ? ` ${remainder} m` : ''}`
    : `${remainder} m`;
}

/** Bare whole numbers mean minutes; explicit hours and minutes also work. */
export function parseBookingNotice(text: string): number | undefined {
  const value = text.trim().toLowerCase();
  if (!value || value.endsWith(',')) return;
  if (/^\d+$/.test(value)) {
    const minutes = Number(value);
    return Number.isSafeInteger(minutes) ? minutes : undefined;
  }
  const match =
    /^(?:(\d+)\s*(?:hours?|hrs?|h)\s*,?\s*)?(?:(\d+)\s*(?:minutes?|mins?|m))?$/.exec(
      value
    );
  if (!match || (match[1] === undefined && match[2] === undefined)) return;
  const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  return Number.isSafeInteger(minutes) ? minutes : undefined;
}
