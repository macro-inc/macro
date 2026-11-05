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
