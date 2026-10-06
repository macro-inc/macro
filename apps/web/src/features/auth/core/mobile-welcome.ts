/** What sending the desktop link to a mobile-web visitor did. */
export type MobileWelcomeResult =
  /** `alreadySent`: this address was emailed before; the confirmation still holds. */
  | { t: 'sent'; alreadySent: boolean }
  | { t: 'invalid-email' }
  | { t: 'rate-limited' }
  | { t: 'failed' };

export function mobileWelcomeFailure(
  result: MobileWelcomeResult
): string | undefined {
  switch (result.t) {
    case 'sent':
      return undefined;
    case 'invalid-email':
      return 'Invalid email address.';
    case 'rate-limited':
      return 'Too many attempts. Please try again later.';
    case 'failed':
      return 'Something went wrong. Please try again.';
  }
}
