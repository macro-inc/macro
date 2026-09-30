import { analytics } from './utilAnalytic';
import { buildAuthServiceUrl } from './utilBaseUrl';

/**
 * Mobile-web email capture, served by the site itself.
 *
 * Signing up and onboarding on a phone is a poor experience, so mobile
 * visitors give us their email and we send them a link to open on desktop.
 * That capture used to live in the app (`/app/mobile-email-signup`), which
 * meant every mobile CTA paid a full app-bundle load before showing an email
 * field. The site now calls the same public auth-service endpoint directly and
 * renders both steps itself, so the flow is a static page plus one fetch.
 */

/** Email-capture page, used by mobile CTAs across the site. */
export const MOBILE_SIGNUP_PATH = '/mobile-signup';

/** "We emailed you a desktop link" confirmation page. */
export const MOBILE_SIGNUP_SENT_PATH = '/mobile-signup-sent';

/**
 * USD value attached to the Meta `Lead` / Google Ads conversion for a captured
 * mobile email. Mirrors `MOBILE_WEB_SIGNUP_LEAD_VALUE` in the app
 * (`apps/web/src/lib/analytics/leadValues.ts`) — Meta's Value Optimization
 * weighs each Lead by it, so keep the two in step when rebalancing.
 */
export const MOBILE_WEB_SIGNUP_LEAD_VALUE = 5;

// Survives the navigation from the capture step to the confirmation step (and a
// refresh of it), which is where the conversions fire.
const SUBMITTED_EMAIL_KEY = 'macro_mobile_signup_email';
const CONVERSION_FIRED_KEY = 'macro_mobile_signup_conversion_fired';

const readSession = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeSession = (key: string, value: string): void => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Private-mode Safari and blocked storage: the flow still works, the
    // confirmation page just falls back to its generic copy.
  }
};

/** The email submitted this session, if the visitor came from the capture step. */
export const submittedEmail = (): string | null =>
  readSession(SUBMITTED_EMAIL_KEY);

/**
 * True once the ad-platform conversions have been fired for `email` this
 * session. The confirmation page is a real URL, so without this a refresh or a
 * second visit would double-count the Meta Lead.
 */
export const conversionAlreadyFired = (email: string | null): boolean =>
  readSession(CONVERSION_FIRED_KEY) === (email ?? '');

export const markConversionFired = (email: string | null): void =>
  writeSession(CONVERSION_FIRED_KEY, email ?? '');

/**
 * Cheap client-side check before we spend a request: the endpoint is rate
 * limited per IP, so a typo shouldn't burn one of the visitor's attempts.
 * The auth service remains the authority on what it accepts.
 */
export const isLikelyEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

export type MobileSignupResult = { ok: true } | { ok: false; message: string };

/**
 * Sends the "open Macro on your computer" email to `email` via the auth
 * service's public `/mobile-welcome-email` endpoint, and identifies the
 * visitor to the analytics providers so the lead is attributable.
 *
 * Resolves with a visitor-facing message instead of throwing — every failure
 * mode here is something the person can act on (fix the address, wait, retry).
 */
export const submitMobileSignup = async (
  email: string
): Promise<MobileSignupResult> => {
  const trimmed = email.trim();
  if (!isLikelyEmail(trimmed)) {
    return { ok: false, message: 'Enter a valid email address.' };
  }

  analytics.identifyEmail(trimmed);

  let response: Response;
  try {
    response = await fetch(buildAuthServiceUrl('/mobile-welcome-email'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: trimmed }),
    });
  } catch {
    return { ok: false, message: 'Network error. Please try again.' };
  }

  // 200 covers both "sent" and `sent: false` (we already emailed this address).
  // The confirmation page is accurate either way, so both advance.
  if (response.ok) {
    writeSession(SUBMITTED_EMAIL_KEY, trimmed);
    return { ok: true };
  }

  if (response.status === 400) {
    return { ok: false, message: 'That email address was not accepted.' };
  }
  if (response.status === 429) {
    return { ok: false, message: 'Too many attempts. Please try again later.' };
  }
  return { ok: false, message: 'Something went wrong. Please try again.' };
};
