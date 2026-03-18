import { SERVER_HOSTS } from '@core/constant/servers';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { RedirectLocation } from '@core/util/authRedirect';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import { isOk } from '@core/util/maybeResult';
import { getNativeMobilePlatform } from '@core/util/platform';
import IconApple from '@macro-icons/macro-apple.svg';
import IconGoogle from '@macro-icons/macro-google.svg';
import IconMail from '@macro-icons/macro-mail.svg';
import { invalidateUserInfo } from '@queries/auth/user-info';
import { authServiceClient } from '@service-auth/client';
import { useLocation } from '@solidjs/router';
import { invoke } from '@tauri-apps/api/core';
import { type JSX, Show } from 'solid-js';
import { Stage } from './Shared';

function LoginOption(props: {
  icon: JSX.Element;
  label: string;
  onClick: () => void;
}) {
  return (
    <div
      onClick={(_e) => {
        if (isTouchDevice()) return;
        props.onClick();
      }}
      // Using onPointerDown so that on touch device able to interact with button before closing virtual keyboard
      onPointerDown={(e) => {
        if (!isTouchDevice()) return;
        e.stopPropagation();
        e.preventDefault();
        props.onClick();
      }}
      class="grid items-center justify-center p-5 border border-dashed border-ink border-t-0 [transition:color_var(--transition)] hover:text-accent hover:transition-none cursor-pointer"
    >
      <div class="grid grid-cols-[min-content_180px] gap-2.5 items-center justify-center">
        {props.icon}
        <div class="whitespace-nowrap">{props.label}</div>
      </div>
    </div>
  );
}

export function LoginOptions(props: { setStage: (next: Stage) => void }) {
  const location = useLocation<RedirectLocation>();

  const startSsoLogin = async (idp_name: string) => {
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
        payload: { authUrl: authUrl.toString(), callbackScheme: 'macro' },
      });

      if (!result.success || !result.token) {
        console.error('Authentication failed:', result.error);
        return;
      }

      unsetTokenPromise();

      const res = await authServiceClient.sessionLogin({
        session_code: result.token,
      });

      if (isOk(res)) {
        invalidateUserInfo();
      }

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
    window.location.href = authUrl.toString();
  };

  return (
    <div class="grid select-none">
      <Show when={getNativeMobilePlatform() === 'ios'}>
        <LoginOption
          icon={<IconApple />}
          label="Continue with Apple"
          onClick={() => startSsoLogin('Apple')}
        />
      </Show>

      <LoginOption
        icon={<IconGoogle />}
        label="Continue with Google"
        onClick={() => startSsoLogin('google')}
      />

      <Show when={!isNativeMobilePlatform()}>
        <LoginOption
          icon={<IconApple />}
          label="Continue with Apple"
          onClick={() => startSsoLogin('Apple')}
        />
      </Show>

      <LoginOption
        icon={<IconMail />}
        label="Continue with Email"
        onClick={() => props.setStage(Stage.Email)}
      />

      <div class="p-5 border border-dashed border-[var(--color-ink)] border-t-0 text-center text-xs">
        By signing up, you agree to our
        <br />
        <a class="underline" href="/terms">
          terms
        </a>{' '}
        and{' '}
        <a class="underline" href="/privacy">
          privacy policy
        </a>
        .
      </div>
    </div>
  );
}
