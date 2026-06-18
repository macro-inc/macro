import { useAnalytics } from '@app/component/analytics-context';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import { ENABLE_NEW_LOGIN_OVERRIDE } from '@core/constant/featureFlags';
import { useEmailLinks } from '@core/email-link';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import LogoIcon from '@icon/macro-logo.svg';
import { useUserInfo } from '@queries/auth';
import {
  invalidateAllAfterLogin,
  invalidateUserInfo,
} from '@queries/auth/user-info';
import { authServiceClient } from '@service-auth/client';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { cn, Surface } from '@ui';
import { detect } from 'detect-browser';
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
import { LoginNew } from './LoginNew';
import { LoginOptions } from './LoginOptions';
import { Stage } from './Shared';
import { VerifyForm } from './VerifyForm';

export function Login() {
  return (
    <ShowFeatureFlag
      key="enable-new-login"
      enabledOverride={ENABLE_NEW_LOGIN_OVERRIDE}
      fallback={<LoginOld />}
    >
      <LoginNew />
    </ShowFeatureFlag>
  );
}

function PostLoginRedirect() {
  const navigate = useNavigate();

  // Login init is owned by the per-method handlers (the session-token effect and
  // onComplete); this redirect only navigates, so login doesn't fire init twice.
  onMount(() => {
    navigate('/', { replace: true });
  });

  return <LoadingBlock />;
}

function LoginOld() {
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
    // token may be an array if the redirect URL contained duplicate token params;
    // take the last one as it is the most recently appended by the auth service
    const rawToken = searchParams.token;
    const session_code = Array.isArray(rawToken)
      ? rawToken[rawToken.length - 1]
      : rawToken;
    if (session_code && typeof session_code === 'string') {
      console.log({ session_code });
      unsetTokenPromise();
      authServiceClient.sessionLogin({ session_code }).then(async (res) => {
        console.log({ res });
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
      });
    }
  });

  const { initEmailLink } = useEmailLinks();

  const onComplete = async () => {
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
    const user = userInfo();

    if (!user || !user.authenticated) return;

    analytics.track('login', {
      method: 'email',
    });
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
    <Show when={!userInfo()?.authenticated} fallback={<PostLoginRedirect />}>
      <div class="flex items-center justify-center size-full p-8 overflow-hidden relative">
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
        <div class="inset-0 absolute text-edge bg-surface opacity-10 -z-1">
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

        <div class="w-full max-w-105 login-card">
          <Surface depth={1}>
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
          </Surface>
        </div>
      </div>
    </Show>
  );
}
