import { SERVER_HOSTS } from '@core/constant/servers';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import { useUserInfo } from '@queries/auth';
import { Navigate, useLocation } from '@solidjs/router';
import { onMount, Show } from 'solid-js';
import { useAnalytics } from '@app/component/analytics-context';
import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import type { RedirectLocation } from '@core/util/authRedirect';
import IconGoogle from '@macro-icons/macro-google.svg';
import LogoIcon from '@macro-icons/macro-logo.svg';

export function Signup() {
  const userInfo = useUserInfo();
  const analytics = useAnalytics();
  const location = useLocation<RedirectLocation>();

  onMount(() => {
    analytics.pageView('signup');
  });

  const startGoogleLogin = () => {
    const authUrl = new URL(`${SERVER_HOSTS['auth-service']}/login/sso`);
    authUrl.searchParams.set('idp_name', 'google');

    const referral_code =
      new URL(window.location.href).searchParams.get('referral_code') ??
      new URLSearchParams(location.state?.originalLocation?.search).get(
        'referral_code'
      );

    if (referral_code) authUrl.searchParams.set('referral_code', referral_code);

    authUrl.searchParams.set(
      'original_url',
      `${window.location.origin}${ROUTER_BASE_CONCAT}welcome`
    );

    window.location.href = authUrl.toString();
  };

  return (
    <Show
      when={!userInfo()?.authenticated}
      fallback={
        <Navigate href={userInfo()?.tutorialComplete ? '/' : '/welcome'} />
      }
    >
      <div class="flex items-center justify-center h-full w-full p-8 overflow-hidden relative">
        <style>
          {
            /*css*/ `
          @keyframes login-fade-up {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .login-card {
            animation: login-fade-up 300ms ease-out both;
          }
          .login-stagger > * {
            animation: login-fade-up 300ms ease-out both;
          }
          .login-stagger > *:nth-child(1) { animation-delay: 50ms; }
          .login-stagger > *:nth-child(2) { animation-delay: 120ms; }
          .login-stagger > *:nth-child(3) { animation-delay: 190ms; }
          .login-stagger > *:nth-child(4) { animation-delay: 260ms; }
          `
          }
        </style>
        <div class="inset-0 absolute text-edge bg-panel opacity-10 -z-1">
          <PcNoiseGrid
            cellSize={30}
            warp={0}
            crunch={0.2}
            freq={0.001}
            size={[0, 0.3]}
            rounding={0}
            fill={0}
            stroke={1}
            speed={[0.017, 0.209]}
          />
        </div>

        <div class="w-full max-w-[420px] login-card">
          <ClippedPanel
            cornerRadius={'4px'}
            class="bg-panel shadow-lg shadow-[#1111]"
          >
            <div class="login-stagger">
              <div class="flex items-center justify-center py-10">
                <LogoIcon class="size-20 text-accent" />
              </div>
              <div class="text-center text-lg font-medium">
                Welcome to Macro
              </div>
              <div class="px-8 pb-4 pt-2 text-center text-sm text-ink/60 leading-relaxed">
                Sign in with Google to sync your inbox and set up your
                workspace.
              </div>
              <div class="w-full">
                <div class="grid select-none border-t border-edge-muted">
                  <div
                    onClick={startGoogleLogin}
                    class="grid items-center justify-center p-4 border-b border-edge-muted [transition:color_var(--transition)] hover:bg-hover/60 hover:text-accent hover:transition-none"
                  >
                    <div class="flex gap-2.5 items-center justify-center">
                      <IconGoogle />
                      <div class="whitespace-nowrap">Sign up with Google</div>
                    </div>
                  </div>

                  <div class="p-4 text-center text-xs text-ink/50">
                    <a
                      class="underline hover:text-ink/70"
                      href={`${ROUTER_BASE_CONCAT}login`}
                    >
                      Existing user? Log in
                    </a>
                  </div>

                  <div class="p-4 pt-0 text-center text-xs text-ink/50">
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
              </div>
            </div>
          </ClippedPanel>
        </div>
      </div>
    </Show>
  );
}
