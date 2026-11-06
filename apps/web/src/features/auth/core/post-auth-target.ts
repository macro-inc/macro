import { sanitizeNext } from '@app/features/onboarding/core/next-target';

export const AGENT_SETUP_PATH = '/agent-setup';

/** Where a freshly signed-in user goes: into onboarding, or straight to a path. */
export type PostAuthTarget =
  | { t: 'onboarding'; next: string | undefined }
  | { t: 'navigate'; to: string };

/**
 * Invite pages answer before onboarding. Joining first means onboarding opens
 * already on the team, instead of burying the invite six steps in, where
 * most invitees quit before reaching it.
 */
function isInvitePath(path: string): boolean {
  return /^\/(team|channel)-invite(\?|$)/.test(path);
}

/**
 * Resolves the `/login?redirect=` deep link after sign-in. Pages that need an
 * account (team and channel invites, meetings) send people here with the page
 * to come back to; without this the link was dropped and everyone landed on
 * Home or in onboarding.
 */
export function postAuthTarget(input: {
  tutorialComplete: boolean;
  isAgent: boolean;
  /** Mobile and native apps skip desktop onboarding. */
  onboardsOnThisDevice: boolean;
  redirect: unknown;
}): PostAuthTarget {
  if (input.isAgent && !input.tutorialComplete) {
    return { t: 'navigate', to: AGENT_SETUP_PATH };
  }
  const redirect = sanitizeNext(input.redirect);
  const needsOnboarding =
    input.onboardsOnThisDevice && !input.tutorialComplete && !input.isAgent;
  if (needsOnboarding && !(redirect && isInvitePath(redirect))) {
    return { t: 'onboarding', next: redirect };
  }
  return { t: 'navigate', to: redirect ?? '/' };
}

/**
 * The desktop sign-in callback, carrying the page's `redirect`. Desktop SSO
 * returns through a pinned `macro:///login` deep link rather than the page
 * sign-in started on, so the deep link would otherwise be lost; the auth
 * service keeps the query and appends the session code.
 *
 * The auth service URL-decodes `original_url` once more after reading it from
 * the query (`UrlEncoded<Url>`), so the redirect is encoded twice here: a
 * redirect with its own `&` would otherwise split into separate parameters.
 * {@link readRedirectParam} accepts it whether or not that extra decode runs.
 */
export function desktopAuthCallbackUrl(
  callbackUrl: string,
  redirect: unknown
): string {
  const next = sanitizeNext(redirect);
  if (!next) return callbackUrl;
  return `${callbackUrl}?redirect=${encodeURIComponent(encodeURIComponent(next))}`;
}

/**
 * The login page's `redirect` parameter, decoded once more when it arrives
 * still encoded (a desktop callback the auth service did not decode twice).
 */
export function readRedirectParam(value: unknown): unknown {
  if (typeof value !== 'string' || !value.startsWith('%2F')) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
