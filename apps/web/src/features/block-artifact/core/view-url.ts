/** Re-request a view URL this long before it expires. */
export const VIEW_URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Never re-request sooner than this, even for a URL that is already due. */
export const VIEW_URL_MIN_REFRESH_MS = 30 * 1000;

/**
 * Milliseconds until a view URL should be replaced, so the frame never loads a
 * page or asset with an expired token. Undefined for an unreadable expiry.
 */
export function viewUrlRefreshDelay(
  expiresAt: string,
  now: number
): number | undefined {
  const expires = Date.parse(expiresAt);
  if (Number.isNaN(expires)) return undefined;

  return Math.max(
    VIEW_URL_MIN_REFRESH_MS,
    expires - now - VIEW_URL_REFRESH_MARGIN_MS
  );
}
