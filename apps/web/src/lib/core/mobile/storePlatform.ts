export type StorePlatform = 'ios' | 'android';

/**
 * The app store this browser's device installs Macro from, or undefined when
 * the user agent doesn't say (computers, other phones). iPadOS Safari reports
 * itself as a Mac, so a touch-capable "Macintosh" counts as iOS.
 */
export function storePlatform(
  userAgent: string,
  maxTouchPoints: number
): StorePlatform | undefined {
  if (
    /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  ) {
    return 'ios';
  }
  if (/Android/.test(userAgent)) return 'android';
  return undefined;
}
