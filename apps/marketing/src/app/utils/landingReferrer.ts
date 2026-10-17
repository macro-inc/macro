/**
 * Phones reach `/mobile-signup` through a full-page hop: `location.href` from
 * the marketing site, or `location.replace` from `/app/signup`. The next
 * document's referrer is that macro.com URL, so PostHog stores it as
 * `$initial_referrer` and the external source is lost.
 *
 * sessionStorage survives those same-tab hops. The web app writes this same
 * key before it redirects; keep them in step
 * (`apps/web/src/lib/analytics/landingReferrer.ts`).
 */
export const LANDING_REFERRER_KEY = 'macro:landing-referrer';

function siteHost(hostname: string) {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

export function isSameSiteReferrer(referrer: string) {
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
 * Referrer to send to PostHog. An external `document.referrer` wins. After a
 * same-site hop, use the external referrer saved on the previous page.
 */
export function attributionReferrer(referrer = document.referrer) {
  rememberLandingReferrer(referrer);
  if (referrer && isSameSiteReferrer(referrer)) {
    return readLandingReferrer() ?? referrer;
  }
  return referrer;
}
