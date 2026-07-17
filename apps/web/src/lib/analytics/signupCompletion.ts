/**
 * Signup-completion tracking.
 *
 * `sign_up` used to fire only from the /signup page, *before* redirecting to
 * SSO — so it counted intent rather than created accounts, and missed everyone
 * who signed up through the regular SSO sign-in (which is where the website
 * sends people). The ad-platform conversions were even further off: they fired
 * when the (now optional) interactive tutorial modal closed.
 *
 * The authoritative signup events are emitted server-side from the
 * create-user webhook, so every creation path counts exactly once even if
 * the user never returns to the app: `sign_up` (PostHog) and
 * `CompleteRegistration` (Meta Conversions API). Only a minority of new
 * accounts ever load the web app with the `signed_up=true` marker, so a
 * browser-only Meta fire undercounts badly — and Meta's delivery algorithm
 * starves when spend scales past the trickle it can see.
 *
 * What remains here is the browser half: the GA sign_up event and Google Ads
 * conversion (browser-only), plus a duplicate Meta CompleteRegistration that
 * exists to contribute the click-id cookies (_fbc/_fbp) only the browser
 * holds — Meta dedupes it against the server fire via the shared
 * `signup:{user_id}` event id. The auth service appends `signed_up=true` to
 * the post-auth redirect; this module consumes that param once and fires
 * them, regardless of which page or device started the flow.
 */
import type { AnalyticsInterface } from './analytics';
import {
  SIGNUP_LEAD_VALUE_BY_TIER,
  SIGNUP_LEAD_VALUE_DEFAULT,
} from './leadValues';

const SIGNED_UP_PARAM = 'signed_up';
const TRACKED_STORAGE_PREFIX = 'macro_sign_up_tracked:';

/**
 * Returns true if the URL carries `signed_up=true`, and removes it (from both
 * the search string and, for the hash router, the hash query) so refreshes
 * and copied links don't re-trigger.
 */
function readAndStripSignedUpParam(): boolean {
  try {
    const url = new URL(window.location.href);
    let found = false;

    if (url.searchParams.get(SIGNED_UP_PARAM) === 'true') {
      found = true;
      url.searchParams.delete(SIGNED_UP_PARAM);
    }

    // Tauri uses a hash router; the param can end up in the hash query.
    const hashQueryIndex = url.hash.indexOf('?');
    if (hashQueryIndex !== -1) {
      const hashPath = url.hash.slice(0, hashQueryIndex);
      const hashParams = new URLSearchParams(
        url.hash.slice(hashQueryIndex + 1)
      );
      if (hashParams.get(SIGNED_UP_PARAM) === 'true') {
        found = true;
        hashParams.delete(SIGNED_UP_PARAM);
        const rest = hashParams.toString();
        url.hash = rest ? `${hashPath}?${rest}` : hashPath;
      }
    }

    if (found) {
      window.history.replaceState(window.history.state, '', url);
    }
    return found;
  } catch {
    return false;
  }
}

function alreadyTracked(userId: string): boolean {
  try {
    return localStorage.getItem(TRACKED_STORAGE_PREFIX + userId) != null;
  } catch {
    return false;
  }
}

function markTracked(userId: string) {
  try {
    localStorage.setItem(TRACKED_STORAGE_PREFIX + userId, '1');
  } catch {
    // localStorage unavailable — the stripped URL param still prevents most
    // double-fires, and the Google conversion dedupes on transaction_id.
  }
}

/**
 * Fires the browser-side signup conversions (GA sign_up, Meta
 * CompleteRegistration, Google Ads signup) exactly once for a freshly created
 * account. The PostHog `sign_up` product event is NOT fired here — it comes
 * from the create-user webhook on the backend. Call once the authenticated
 * user is known (so the events can be attributed and deduped by user id).
 * No-ops unless the URL carries the backend's `signed_up=true` marker.
 */
export function trackSignupCompletion(
  analytics: AnalyticsInterface,
  user: { id: string }
) {
  if (!readAndStripSignedUpParam()) return;
  if (alreadyTracked(user.id)) return;
  markTracked(user.id);

  // GA4 recommended-event name; browser GA has the client id for attribution.
  analytics.track('sign_up', {}, ['ga']);

  // Paid signups return from Stripe with a `type` param; plain signups have
  // no tier yet and count at the free-signup lead value. Purchase value is
  // tracked separately via subscription_success. Checked in both the search
  // and hash query for the same hash-router reason as the signed_up param.
  const hashQueryIndex = window.location.hash.indexOf('?');
  const hashParams =
    hashQueryIndex !== -1
      ? new URLSearchParams(window.location.hash.slice(hashQueryIndex + 1))
      : null;
  const tier =
    new URLSearchParams(window.location.search).get('type') ??
    hashParams?.get('type') ??
    'free';
  const value = SIGNUP_LEAD_VALUE_BY_TIER[tier] ?? SIGNUP_LEAD_VALUE_DEFAULT;

  analytics.trackMeta(
    'CompleteRegistration',
    // Must mirror the server-side payload in create_user_webhook.rs exactly:
    // the create-user webhook fires this same event through the Conversions
    // API with the same event id, and Meta keeps whichever of the deduped
    // pair lands first (almost always the server). Accounts are always free
    // at creation, so both sides report the flat signup value; the tier-based
    // value below stays on the Google conversion, which is browser-only.
    {
      content_name: 'account_created',
      content_category: 'free',
      value: SIGNUP_LEAD_VALUE_DEFAULT,
      currency: 'USD',
    },
    { eventID: `signup:${user.id}` }
  );
  analytics.trackGoogleConversion('signup', {
    value,
    currency: 'USD',
    // Google dedupes server-side on transaction_id, so a re-fire from another
    // device or cleared storage still counts once.
    transaction_id: user.id,
  });
}
