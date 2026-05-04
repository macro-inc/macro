/**
 * Google Ads Conversion Action labels, keyed by semantic name.
 *
 * Unlike Meta — which has a fixed standard-event taxonomy — each Google Ads
 * conversion is its own configured action in the Ads UI with its own
 * `AW-{id}/{label}` send-target. Group these into a single Conversion Goal
 * with all actions marked Primary so a campaign optimizes against the sum of
 * their values.
 *
 * Volume balance matters: Smart Bidding sums values across primaries, so a
 * high-frequency low-value action will dominate a low-frequency high-value
 * one unless the per-fire `value` is tuned to compensate. Lead values are
 * shared with `leadValues.ts` for now; rebalance there.
 */

/** Google Ads account ID (the `AW-...` prefix). */
export const GOOGLE_ADS_ID = 'AW-11035820781';

/**
 * Per-action conversion labels from the Ads UI.
 *
 * To add an action: create the Conversion Action in Google Ads (Category:
 * Sign-up / Submit lead form / Purchase as appropriate, Count: One, Value:
 * "Use different values"), then paste its label here.
 */
export const GOOGLE_CONVERSION_LABELS = {
  /** Mobile web email capture — user submitted email to receive desktop link. */
  mobile_web_lead: 'lCHSCIntvaccEO2FpY4p',
  /** Onboarding completed (post-Stripe for paid tiers, direct for free). */
  signup: 'Gk2rCI7svaccEO2FpY4p',
} as const;

export type GoogleConversionAction = keyof typeof GOOGLE_CONVERSION_LABELS;

export const googleConversionSendTo = (action: GoogleConversionAction) =>
  `${GOOGLE_ADS_ID}/${GOOGLE_CONVERSION_LABELS[action]}`;
