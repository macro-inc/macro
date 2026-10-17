/**
 * Same key and rules as `apps/marketing/src/app/utils/landingReferrer.ts`.
 * `/app/signup` sends phones to `/mobile-signup` with `location.replace`
 * before PostHog's first event, so the external referrer has to be stored
 * here or the marketing page records this macro.com URL as `$initial_referrer`.
 */
export const LANDING_REFERRER_KEY = 'macro:landing-referrer';

type InitialReferrerEvent = {
  $set_once?: Record<string, unknown>;
};

function siteHost(hostname: string) {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

function isSameSiteReferrer(referrer: string) {
  try {
    return (
      siteHost(new URL(referrer).hostname) ===
      siteHost(window.location.hostname)
    );
  } catch {
    return false;
  }
}

function readLandingReferrer() {
  try {
    const stored = sessionStorage.getItem(LANDING_REFERRER_KEY);
    if (!stored || isSameSiteReferrer(stored)) return;
    return stored;
  } catch {
    return;
  }
}

/**
 * Keep the latest external referrer. A same-site hop must not replace it.
 * An empty referrer is a new direct visit, so drop the saved value. Otherwise
 * a later same-site signup hop would still be credited to the earlier source.
 */
export function rememberLandingReferrer(referrer = document.referrer) {
  try {
    if (!referrer) {
      sessionStorage.removeItem(LANDING_REFERRER_KEY);
      return;
    }
    if (isSameSiteReferrer(referrer)) return;
    new URL(referrer);
    sessionStorage.setItem(LANDING_REFERRER_KEY, referrer);
  } catch {
    // Private mode and in-app browsers can block storage, and an unparseable
    // referrer must not replace one we already kept.
  }
}

/**
 * The app's first event can be the signup page that immediately redirects.
 * `$set_once` is what creates `$initial_referrer`; replace it when that value
 * is only the previous macro.com page.
 */
export function restoreInitialReferrer(event: InitialReferrerEvent) {
  const setOnce = event.$set_once;
  const current = setOnce?.$initial_referrer;
  if (!setOnce || typeof current !== 'string' || !isSameSiteReferrer(current)) {
    return;
  }
  const external = readLandingReferrer();
  if (!external) return;
  setOnce.$initial_referrer = external;
  setOnce.$initial_referring_domain = new URL(external).hostname;
}
