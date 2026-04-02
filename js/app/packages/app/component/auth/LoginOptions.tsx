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
import { invalidateAllAfterLogin } from '@queries/auth/user-info';
import { authServiceClient } from '@service-auth/client';
import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { useLocation } from '@solidjs/router';
import { invoke } from '@tauri-apps/api/core';
import { type JSX, Show } from 'solid-js';
import { Stage } from './Shared';
import { GOOGLE_GMAIL_IDP } from '@core/auth/email';
import { useAnalytics } from '@app/component/analytics-context';
import type { AnalyticsProvider } from '@app/lib/analytics';
import { useEmailLinks } from '@core/email-link';

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
      class="grid items-center justify-center p-4 border-b border-edge-muted [transition:color_var(--transition)] hover:bg-hover/60 hover:text-accent hover:transition-none"
    >
      <div class="flex gap-2.5 items-center justify-center">
        {props.icon}
        <div class="whitespace-nowrap">{props.label}</div>
      </div>
    </div>
  );
}

export function LoginOptions(props: {
  setStage: (next: Stage) => void;
  signupMode?: boolean;
}) {
  const analytics = useAnalytics();
  const location = useLocation<RedirectLocation>();
  const { initEmailLink } = useEmailLinks();

  const startSsoLogin = async (idp_name: string) => {
    const analyticsEvent = props.signupMode ? 'sign_up' : 'login';
    const analyticsProviders: AnalyticsProvider[] = props.signupMode
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

      if (isOk(res)) {
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

      analytics.track(
        analyticsEvent,
        {
          method: idp_name,
        },
        analyticsProviders
      );

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

    analytics.track(
      analyticsEvent,
      {
        method: idp_name,
      },
      analyticsProviders
    );

    window.location.href = authUrl.toString();
  };

  return (
    <div class="grid select-none border-t border-edge-muted">
      <Show when={getNativeMobilePlatform() === 'ios'}>
        <LoginOption
          icon={<IconApple />}
          label="Continue with Apple"
          onClick={() => startSsoLogin('Apple')}
        />
      </Show>

      <LoginOption
        icon={<IconGoogle />}
        label={
          props.signupMode ? 'Sign up with Google' : 'Continue with Google'
        }
        onClick={() => startSsoLogin(GOOGLE_GMAIL_IDP)}
      />

      <Show when={!props.signupMode && !isNativeMobilePlatform()}>
        <LoginOption
          icon={<IconApple />}
          label="Continue with Apple"
          onClick={() => startSsoLogin('Apple')}
        />
      </Show>

      <Show when={!props.signupMode}>
        <LoginOption
          icon={<IconMail />}
          label="Continue with Email"
          onClick={() => props.setStage(Stage.Email)}
        />
      </Show>

      <Show when={props.signupMode}>
        <div class="p-4 text-center text-xs text-ink/50">
          <a
            class="underline hover:text-ink/70"
            href={`${ROUTER_BASE_CONCAT}login`}
          >
            Existing user? Log in
          </a>
        </div>
      </Show>

      <div class="p-4 text-center text-xs text-ink/50">
        By signing up, you agree to our
        <br />
        <a class="underline hover:text-ink/70" href="/terms">
          terms
        </a>{' '}
        and{' '}
        <a class="underline hover:text-ink/70" href="/privacy">
          privacy policy
        </a>
        .
      </div>
    </div>
  );
}
