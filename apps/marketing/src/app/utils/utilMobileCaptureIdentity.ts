/** Campaign fields kept on a person identified on the site. */

export const MOBILE_CAPTURE_ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'fbclid',
] as const;

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
