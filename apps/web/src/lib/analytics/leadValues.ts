/**
 * USD values attached to Meta `Lead` fires. Meta's Value Optimization weighs
 * each Lead by the `value` we declare, so these numbers directly shape which
 * audiences Meta favors. Tune here; both call sites read from this file.
 *
 * Corresponding server-side values (cal.com bookings) live in the
 * `CAL_EVENT_TYPE_CONTENT_NAMES_KEY` secret — keep the two in sync when
 * rebalancing.
 */

/** Mobile web email capture (user can't sign up on mobile; we email them). */
export const MOBILE_WEB_SIGNUP_LEAD_VALUE = 5;

/** Signup Lead value per subscription tier. */
export const SIGNUP_LEAD_VALUE_BY_TIER: Record<string, number> = {
  free: 20,
  premium: 300,
};

/** Fallback used when the tier query param is unrecognized. */
export const SIGNUP_LEAD_VALUE_DEFAULT = SIGNUP_LEAD_VALUE_BY_TIER.free;

/**
 * Google Ads value of a confirmed subscription start, per plan. Pro starts as
 * a trial; Max is paid up front at five times the price, so bidding should
 * favor it.
 */
export const SUBSCRIPTION_START_VALUE_BY_TIER: Record<string, number> = {
  premium: SIGNUP_LEAD_VALUE_BY_TIER.premium,
  max: 1000,
};

/** Fallback when the returning checkout didn't say which plan was bought. */
export const SUBSCRIPTION_START_VALUE_DEFAULT =
  SUBSCRIPTION_START_VALUE_BY_TIER.premium;
