import { useAnalytics } from '@app/component/analytics-context';
import type { AnalyticsProvider } from '@app/lib/analytics';
import { SERVER_HOSTS } from '@core/constant/servers';
import { useEmailLinks } from '@core/email-link';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import type { RedirectLocation } from '@core/util/authRedirect';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import { getNativeMobilePlatform } from '@core/util/platform';
import { invalidateAllAfterLogin } from '@queries/auth/user-info';
import { authServiceClient } from '@service-auth/client';
import { useLocation } from '@solidjs/router';
import { invoke } from '@tauri-apps/api/core';

export function useSsoLogin(opts?: { signupMode?: boolean }) {
  const analytics = useAnalytics();
  const location = useLocation<RedirectLocation>();
  const { initEmailLink } = useEmailLinks();

  return async (idp_name: string) => {
    const analyticsEvent = opts?.signupMode ? 'sign_up' : 'login';
    const analyticsProviders: AnalyticsProvider[] = opts?.signupMode
      ? ['ga', 'meta-pixel', 'posthog']
      : ['posthog'];

    const authUrl = new URL(`${SERVER_HOSTS['auth-service']}/login/sso`);
    authUrl.searchParams.set('idp_name', idp_name);

    const referral_code =
      new URL(window.location.href).searchParams.get('referral_code') ??
      new URLSearchParams(location.state?.originalLocation?.search).get(
        'referral_code'
      );

    if (referral_code) authUrl.searchParams.set('referral_code', referral_code);

    if (isNativeMobilePlatform()) {
      authUrl.searchParams.set('is_mobile', 'true');
    }

    if (getNativeMobilePlatform() === 'ios') {
      // iOS: use ASWebAuthenticationSession via tauri-plugin-auth
      // so the auth flow stays in-app (required by App Store)
      authUrl.searchParams.set('original_url', 'macro://login');

      const result = await invoke<{
        success: boolean;
        token?: string;
        error?: string;
      }>('plugin:auth|authenticate', {
        payload: {
          authUrl: authUrl.toString(),
          callbackScheme: 'macro',
          ephemeralSession: true,
        },
      });

      if (!result.success || !result.token) {
        console.error('Authentication failed:', result.error);
        return;
      }

      unsetTokenPromise();

      const res = await authServiceClient.sessionLogin({
        session_code: result.token,
      });

      if (res.isOk()) {
        await invalidateAllAfterLogin();
        await initEmailLink().match(
          () => {},
          (err) => {
            if (err.tag !== 'AlreadyInitialized') {
              console.error('Failed to init email link on login', err);
            }
          }
        );
      }

      analytics.track(analyticsEvent, { method: idp_name }, analyticsProviders);

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
