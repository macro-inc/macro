import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { onboardingRedirectPath } from '@app/features/onboarding/core/next-target';
import { initAndStartEmailSync } from '@core/email-link';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { fireAndForget } from '@core/util/fireAndForget';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { useLocation, useNavigate } from '@solidjs/router';
import { createEffect } from 'solid-js';

/**
 * First-time users (tutorial not yet completed) can reach the app without
 * passing through a login route that inits the email link (marketing SSO
 * returns to /app, not /login), so this kicks off email sync once. Idempotent
 * on the backend; AlreadyInitialized is ignored.
 */
function startFirstRunEmailSync() {
  fireAndForget(
    initAndStartEmailSync().match(
      () => {},
      (err) => {
        if (err.tag !== 'AlreadyInitialized') {
          console.error('Failed to init email link for new user', err);
        }
      }
    ),
    'email-sync'
  );
}

/**
 * Sets up a first-time user: starts their email sync, then sends web users
 * (desktop and phone browsers) into the onboarding flow at /onboarding, and
 * new agents on any platform to their setup page. App chrome runs it, so it
 * fires on any app destination (marketing SSO lands on /app, not /login) and
 * never on the onboarding pages themselves.
 *
 * Email sync starts in the same effect, before the navigation: /onboarding
 * renders outside the app chrome, and an effect of the chrome still queued
 * behind that navigation is disposed with the chrome before it runs.
 */
export function useFirstRunSetup() {
  const userInfoQuery = useUserInfoQuery();
  const navigate = useNavigate();
  const location = useLocation();
  // Keyed by user id, not a bare flag, so a native mobile logout→login of a
  // different user in the same session still inits.
  let emailInitForUserId: string | undefined;
  createEffect(() => {
    // A pending read would suspend the chrome; wait for the user instead.
    const data = userInfoQuery.isSuccess ? userInfoQuery.data : undefined;
    if (data?.authenticated !== true || data.tutorialComplete !== false) {
      return;
    }
    // Agents skip onboarding: their setup page shows their SDK token.
    if (data.isAgent) {
      navigate('/agent-setup', { replace: true });
      return;
    }
    if (emailInitForUserId !== data.id) {
      emailInitForUserId = data.id;
      startFirstRunEmailSync();
    }
    if (isNativeMobilePlatform()) return;
    // Preserve the deep link the user arrived on (a shared doc, an invite)
    // as ?next, and a lifecycle-email ?step, so finish() and the flow can
    // resume. Base-relative so navigate() can resolve it against the router.
    const target =
      location.pathname.slice(ROUTER_BASE_CONCAT.length - 1) + location.search;
    navigate(onboardingRedirectPath(target), { replace: true });
  });
}
