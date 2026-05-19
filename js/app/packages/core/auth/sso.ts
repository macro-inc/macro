import { SERVER_HOSTS } from '@core/constant/servers';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { unsetTokenPromise } from '@core/util/fetchWithToken';

import { getNativeMobilePlatform } from '@core/util/platform';
import { invalidateAllAfterLogin } from '@queries/auth/user-info';
import { authServiceClient } from '@service-auth/client';
import { invoke } from '@tauri-apps/api/core';
import { GOOGLE_GMAIL_IDP } from './email';

export type StartSsoLoginParams = {
  idpName?: string;
  /** Where to redirect after auth on web. Ignored on native mobile. */
  returnPath?: string;
  /** Pre-fill the email field on the OAuth provider's login screen. */
  loginHint?: string;
};

/**
 * Starts an SSO login flow.
 * - Native iOS: performs auth inline via Tauri plugin, returns true on success.
 * - Web: redirects to the SSO URL (the returned promise never resolves).
 */
export async function startSsoLogin(
  params: StartSsoLoginParams = {}
): Promise<boolean> {
  const idpName = params.idpName ?? GOOGLE_GMAIL_IDP;
  const authUrl = new URL(`${SERVER_HOSTS['auth-service']}/login/sso`);
  authUrl.searchParams.set('idp_name', idpName);

  const referralCode = new URL(window.location.href).searchParams.get(
    'referral_code'
  );
  if (referralCode) authUrl.searchParams.set('referral_code', referralCode);
  if (params.loginHint)
    authUrl.searchParams.set('login_hint', params.loginHint);

  if (isNativeMobilePlatform()) {
    authUrl.searchParams.set('is_mobile', 'true');
  }

  if (getNativeMobilePlatform() === 'ios') {
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
      return false;
    }

    unsetTokenPromise();
    const res = await authServiceClient.sessionLogin({
      session_code: result.token,
    });

    if (res.isOk()) {
      await invalidateAllAfterLogin();
      return true;
    }

    return false;
  }

  // Web: redirect to SSO — page navigates away, promise never resolves.
  if (params.returnPath) {
    authUrl.searchParams.set(
      'original_url',
      `${window.location.origin}${params.returnPath}`
    );
  } else {
    authUrl.searchParams.set('original_url', window.location.href);
  }
  window.location.href = authUrl.toString();
  return new Promise(() => {});
}
