/**
 * Identity payload for the phone email-capture flow.
 *
 * The web app has a copy in `apps/web/src/lib/analytics/mobileCaptureIdentity.ts`.
 * Keep the two in step: the marketing site cannot import the app.
 */

export const MOBILE_CAPTURE_ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'fbclid',
] as const;

/** Distinct id for a captured email. Mixed case must not create a second person. */
export const normalizeAnalyticsEmail = (
  email: string | null | undefined
): string => (email ?? '').trim().toLowerCase();

/** Coarse device label stored once on the captured person. */
export const mobileCaptureDevice = (userAgent: string): string => {
  if (/iPad|Tablet|PlayBook|Silk/i.test(userAgent)) return 'tablet';
  if (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(userAgent)) return 'mobile';
  return 'desktop';
};

/** Landing-page campaign fields worth keeping on the person (`$set_once`). */
export const pickMobileCaptureAttribution = (
  source: Record<string, unknown>
): Record<string, string> => {
  const picked: Record<string, string> = {};
  for (const key of MOBILE_CAPTURE_ATTRIBUTION_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value) picked[key] = value;
  }
  return picked;
};

/** Person properties set once when the email is first captured. */
export const mobileCaptureSetOnce = (input: {
  capturedAt: string;
  device: string;
  search: string;
}): Record<string, string> => {
  const query = input.search.startsWith('?')
    ? input.search.slice(1)
    : input.search;
  return {
    mobile_capture_at: input.capturedAt,
    mobile_capture_device: input.device,
    ...pickMobileCaptureAttribution(
      Object.fromEntries(new URLSearchParams(query))
    ),
  };
};
