import { cn } from '@ui/utils/classname';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import { isOk } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import {
  invalidateAllAfterLogin,
  invalidateUserInfo,
} from '@queries/auth/user-info';
import { Navigate, useSearchParams } from '@solidjs/router';
import {
  createEffect,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { EmailForm } from './EmailForm';
import { LoginOptions } from './LoginOptions';
import { Stage } from './Shared';
import { VerifyForm } from './VerifyForm';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { useAnalytics } from '@app/component/analytics-context';
import { detect } from 'detect-browser';
import { useUserInfo } from '@queries/auth';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import LogoIcon from '@macro-icons/macro-logo.svg';

export function Login() {
  const [stage, setStage] = createSignal(Stage.None);
  const userInfo = useUserInfo();
  const [searchParams] = useSearchParams();
  const analytics = useAnalytics();

  onMount(() => {
    analytics.pageView('login');
  });

  const identifyUser = () => {
    const user = userInfo();

    if (!user || !user.authenticated) return;

    const platform = detect(navigator.userAgent);
    analytics.identify(user.id, {
      email: user.email,
      os: platform?.os?.replaceAll(' ', ''),
    });
  };

  createEffect(() => {
    if (userInfo()?.authenticated) {
      invalidateUserInfo().then(identifyUser);
    }
  });

  createEffect(() => {
    if (searchParams.email) {
      setStage(Stage.Email);
    }
    // block copied from Mobile.tsx
    if (searchParams.token && typeof searchParams.token === 'string') {
      const session_code = searchParams.token;
      console.log({ session_code });
      unsetTokenPromise();
      authServiceClient.sessionLogin({ session_code }).then((res) => {
        console.log({ res });
        if (isOk(res)) {
          invalidateAllAfterLogin();
        }
      });
    }
  });

  const onComplete = async () => {
    unsetTokenPromise();
    await invalidateAllAfterLogin();
    const user = userInfo();

    if (!user || !user.authenticated) return;

    analytics.track('login');
    identifyUser();
  };

  onCleanup(() => {
    setStage(Stage.Email);
  });

  const onStageChange = (next: Stage) => {
    if (next === Stage.Done) {
      onComplete();
    }
    setStage(next);
  };

  return (
    <Show when={!userInfo()?.authenticated} fallback={<Navigate href="/" />}>
      <div class="flex items-center justify-center h-full w-full p-8 overflow-hidden relative">
        <style>{
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
          .login-stagger > *:nth-child(5) { animation-delay: 330ms; }
        `
        }</style>
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
              <div
                class={cn(
                  'flex items-center justify-center py-10',
                  virtualKeyboardVisible() && 'hidden'
                )}
              >
                <LogoIcon class="size-20 text-accent" />
              </div>
              <div class="w-full">
                <Switch>
                  <Match when={stage() === Stage.None}>
                    <LoginOptions setStage={onStageChange} />
                  </Match>
                  <Match when={stage() === Stage.Email}>
                    <EmailForm setStage={onStageChange} />
                  </Match>
                  <Match when={stage() === Stage.Verify}>
                    <VerifyForm setStage={onStageChange} />
                  </Match>
                </Switch>
              </div>
            </div>
          </ClippedPanel>
        </div>
      </div>
    </Show>
  );
}
