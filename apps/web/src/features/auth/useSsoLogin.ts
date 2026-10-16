import type { AnalyticsProvider } from '@app/lib/analytics';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import {
  createNativeAuthSession,
  DESKTOP_AUTH_CALLBACK_URL,
  openDesktopAuthSession,
} from '@core/auth/native-auth';
import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { useEmailLinks } from '@core/email-link';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import type { RedirectLocation } from '@core/util/authRedirect';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import { isPlatform } from '@core/util/platform';
import { setPostLoginRedirect } from '@core/util/postLoginRedirect';
import { invalidateAllAfterLogin } from '@queries/auth/user-info';
import { authServiceClient } from '@service-auth/client';
import { useLocation } from '@solidjs/router';
import { DEVELOPMENT_PROXY_PREFIX } from '../../lib/core/constant/developmentProxy';

/**
 * Run the hosted flow in the system browser and return through the `macro://`
 * deep link.
 *
 * The callback is pinned rather than derived from the current page by the
 * native navigation plugin: that rewrite only runs for a navigation it
 * classifies as external, so behind the development proxy's same-origin auth
 * host it never fires and the callback lands back in the browser. It also
 * derives the callback from whatever page sign-in started on — normally
 * `/welcome`, which does not redeem session codes.
 */
async function startDesktopSso(
  authUrl: URL,
  originalLocation: RedirectLocation['originalLocation'] | undefined
) {
  authUrl.searchParams.set('original_url', DESKTOP_AUTH_CALLBACK_URL);

  // The callback route sends the user home, so park the destination they were
  // headed for; BasePathComponent restores it after sign-in.
  if (originalLocation) {
    const { pathname, search, hash } = originalLocation;
    setPostLoginRedirect(`${pathname}${search}${hash}`);
  }

  const result = await openDesktopAuthSession(authUrl.toString());
  if (!result.success) {
    console.error('Failed to open the browser for sign-in', result.error);
    toast.failure('Sign-in failed. Please try again.');
  }
}

export function useSsoLogin(opts?: { signupMode?: boolean }) {
  const analytics = useAnalytics();
  const location = useLocation<RedirectLocation>();
  const { initEmailLink } = useEmailLinks();

  return async (idp_name: string) => {
    // Both events are pre-redirect *intent*. The authoritative sign_up (and
    // the ad conversions) fire post-auth when the backend marks the session
    // as a freshly created account — see lib/analytics/signupCompletion.ts.
    const analyticsEvent = opts?.signupMode ? 'sign_up_click' : 'login';
    const analyticsProviders: AnalyticsProvider[] = ['posthog'];

    const authUrl = new URL(`${SERVER_HOSTS['auth-service']}/login/sso`);
    authUrl.searchParams.set('idp_name', idp_name);

    const referral_code =
      new URL(window.location.href).searchParams.get('referral_code') ??
      new URLSearchParams(location.state?.originalLocation?.search).get(
        'referral_code'
      );

    if (referral_code) authUrl.searchParams.set('referral_code', referral_code);

    const desktop = isPlatform('desktop');

    // The hosted OAuth callback sets cookies on macro.com. A proxied browser,
    // and every native shell, needs the session-code handoff to establish
    // cookies locally instead.
    if (
      isNativeMobilePlatform() ||
      desktop ||
      authUrl.pathname.startsWith(`${DEVELOPMENT_PROXY_PREFIX}/`)
    ) {
      authUrl.searchParams.set('is_mobile', 'true');
    }

    if (isNativeMobilePlatform()) {
      const session = createNativeAuthSession('login');
      authUrl.searchParams.set('original_url', session.callbackUrl);
      const result = await session.authenticate(authUrl.toString());

      if (!result.success || !result.token) {
        // A canceled sheet is a deliberate user action, not a failure.
        if (result.error !== 'User canceled login') {
          console.error('Authentication failed:', result.error);
          toast.failure('Sign-in failed. Please try again.');
        }
        return;
      }

      const res = await authServiceClient.sessionLogin({
        session_code: result.token,
      });

      if (res.isOk()) {
        // Reset token state only after the session cookies have actually
        // changed — resetting before sessionLogin opens a window where a
        // visibility-triggered refresh re-latches under the new generation.
        unsetTokenPromise();
        await invalidateAllAfterLogin();
        await initEmailLink().match(
          () => {},
          (err) => {
            if (err.tag !== 'AlreadyInitialized') {
              console.error('Failed to init email link on login', err);
            }
          }
        );
      } else {
        console.error('Failed to redeem session code', res.error);
        toast.failure('Sign-in failed. Please try again.');
      }

      analytics.track(analyticsEvent, { method: idp_name }, analyticsProviders);

      return;
    }

    if (desktop) {
      analytics.track(analyticsEvent, { method: idp_name }, analyticsProviders);
      await startDesktopSso(authUrl, location.state?.originalLocation);
      return;
    }

    if (location.state?.originalLocation) {
      const { pathname, search, hash } = location.state.originalLocation;

      authUrl.searchParams.set(
        'original_url',
        `${window.location.origin}${pathname}${search}${hash}`
      );
    } else {
      authUrl.searchParams.set('original_url', window.location.href);
    }

    analytics.track(analyticsEvent, { method: idp_name }, analyticsProviders);

    window.location.href = authUrl.toString();
  };
}
