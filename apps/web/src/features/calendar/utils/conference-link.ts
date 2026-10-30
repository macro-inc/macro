/** Restrict conferencing links to web URLs before presenting a join action. */
export function safeConferenceUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/** Select the connected account only when joining; keep stored/copied links neutral. */
export function conferenceJoinUrl(value: string, accountEmail?: string) {
  if (!accountEmail?.trim()) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'meet.google.com') {
      return value;
    }
    // Numeric authuser values depend on the browser's Google account order.
    url.searchParams.set('authuser', accountEmail.trim());
    return url.toString();
  } catch {
    return value;
  }
}
