/**
 * Identity helpers for people the retired phone email capture already
 * identified by email; they still arrive through their emailed desktop link.
 */

/** Distinct id for a captured email. Mixed case must not create a second person. */
export const normalizeAnalyticsEmail = (
  email: string | null | undefined
): string => (email ?? '').trim().toLowerCase();
