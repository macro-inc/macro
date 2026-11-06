import { analytics } from './utilAnalytic';
import { buildAuthServiceUrl, capturedAttribution } from './utilBaseUrl';
import { normalizeAnalyticsEmail } from './utilMobileCaptureIdentity';

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

export type MobileStorePlatform = 'ios' | 'android';

/**
 * The app store a visitor's device installs Macro from, or undefined on a
 * computer. iPadOS Safari reports itself as a Mac, so a touch-capable
 * "Macintosh" counts as iOS.
 */
export const mobileStorePlatform = (
  userAgent: string,
  maxTouchPoints: number
): MobileStorePlatform | undefined => {
  if (
    /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  )
    return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return undefined;
};

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

/** Must match `SendMobileWelcomeEmailError::PersonalEmail` in the auth service. */
const WORK_EMAIL_REQUIRED = 'Please use your work email or Gmail';

export type MobileSignupResult = { ok: true } | { ok: false; message: string };

/**
 * Identifies the visitor as this email, then records `mobile_signup_submitted`
 * on that person. Identification has to happen first: an event captured on the
 * anonymous id does not reliably move onto the email person afterward.
 *
 * Returns the normalized email, or null when the address should not be sent.
 */
export const recordMobileSignupSubmitted = (
  email: string,
  input: { buttonName: string; pageLocation: string }
): string | null => {
  const normalized = normalizeAnalyticsEmail(email);
  if (!isLikelyEmail(normalized)) return null;
  analytics.identifyMobileCapture(normalized);
  analytics.track('mobile_signup_submitted', {
    page_location: input.pageLocation,
    button_name: input.buttonName,
  });
  return normalized;
};

/**
 * Sends the "open Macro on your computer" email to `email` via the auth
 * service's public `/mobile-welcome-email` endpoint.
 *
 * The caller identifies the visitor and records `mobile_signup_submitted`
 * first (`recordMobileSignupSubmitted`), so this request does not touch
 * analytics. Resolves with a visitor-facing message instead of throwing —
 * every failure mode here is something the person can act on (fix the
 * address, wait, retry).
 */
export const submitMobileSignup = async (
  email: string
): Promise<MobileSignupResult> => {
  const normalized = normalizeAnalyticsEmail(email);
  if (!isLikelyEmail(normalized)) {
    return { ok: false, message: 'Enter a valid email address.' };
  }

  let response: Response;
  try {
    const attribution = capturedAttribution();
    response = await fetch(buildAuthServiceUrl('/mobile-welcome-email'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        Object.keys(attribution).length > 0
          ? { email: normalized, attribution }
          : { email: normalized }
      ),
    });
  } catch {
    return { ok: false, message: 'Network error. Please try again.' };
  }

  // 200 covers both "sent" and `sent: false` (we already emailed this address).
  // The confirmation page is accurate either way, so both advance.
  if (response.ok) {
    writeSession(SUBMITTED_EMAIL_KEY, normalized);
    return { ok: true };
  }

  if (response.status === 400) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    return {
      ok: false,
      message:
        body?.message === WORK_EMAIL_REQUIRED
          ? `${WORK_EMAIL_REQUIRED}.`
          : 'That email address was not accepted.',
    };
  }
  if (response.status === 429) {
    return { ok: false, message: 'Too many attempts. Please try again later.' };
  }
  return { ok: false, message: 'Something went wrong. Please try again.' };
};

/**
 * UTM tags on the link a captured visitor sends to their team, so the people
 * who arrive through it are counted as invites in first-touch attribution.
 */
const TEAM_INVITE_UTM = {
  utm_source: 'mobile_invite',
  utm_medium: 'share',
  utm_campaign: 'team_invite',
};

export const teamInviteUrl = (origin: string): string =>
  `${origin}/?${new URLSearchParams(TEAM_INVITE_UTM).toString()}`;

export const TEAM_INVITE_TEXT =
  "I'm setting up Macro for our team: email, chat, docs and tasks in one app.";

export type TeamInviteResult = 'shared' | 'cancelled' | 'copied' | 'failed';

/**
 * Hands the invite link to the phone's share sheet, so the visitor can send it
 * through whatever they already use with their team. In-app browsers (where
 * most ad traffic lands) often lack the share sheet, so the link is copied to
 * the clipboard instead.
 */
type ShareTarget = {
  share?: (data: ShareData) => Promise<void>;
  clipboard: { writeText: (text: string) => Promise<void> };
};

export const shareTeamInvite = async (
  url: string,
  nav: ShareTarget = navigator
): Promise<TeamInviteResult> => {
  if (nav.share) {
    try {
      await nav.share({ title: 'Macro', text: TEAM_INVITE_TEXT, url });
      return 'shared';
    } catch (error) {
      // AbortError: the visitor closed the sheet. Anything else (a webview
      // that exposes the API but refuses it) falls through to copying.
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  try {
    await nav.clipboard.writeText(`${TEAM_INVITE_TEXT} ${url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
};
