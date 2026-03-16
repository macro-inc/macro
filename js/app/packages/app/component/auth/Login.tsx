import { cn } from '@ui/utils/classname';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import { isOk } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import { invalidateUserInfo } from '@queries/auth/user-info';
import { Navigate, useSearchParams } from '@solidjs/router';
import {
  createEffect,
  createSignal,
  lazy,
  Match,
  onCleanup,
  Show,
  Suspense,
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

// Lazy load ThreeWireframe to keep three.js out of main bundle
const ThreeWireframe = lazy(() => import('./ThreeWireframe'));

export function Login() {
  const [stage, setStage] = createSignal(Stage.None);
  const userInfo = useUserInfo();
  const [searchParams] = useSearchParams();
  const analytics = useAnalytics();

  const identifyUser = () => {
    const user = userInfo();

    if (!user || !user.authenticated) return;

    const platform = detect(navigator.userAgent);
    analytics.identify(user.id, {
      email: user.email,
      os: `${platform?.os?.replaceAll(' ', '')}`,
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
      invalidateUserInfo();
      authServiceClient.sessionLogin({ session_code }).then((res) => {
        console.log({ res });
        if (isOk(res)) {
          invalidateUserInfo();
        }
      });
    }
  });

  const onComplete = async () => {
    unsetTokenPromise();
    await invalidateUserInfo();
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
      <div class="grid w-full h-full items-center justify-center font-mono text-[15px]">
        <div class="grid w-min">
          <div
            class={cn(
              'border border-dashed border-[var(--color-ink)] box-border w-[350px]',
              virtualKeyboardVisible() && 'hidden'
            )}
          >
            <Suspense
              fallback={
                <div
                  style={{
                    width: 'min(350px, 100%)',
                    'aspect-ratio': '1 / 1',
                  }}
                />
              }
            >
              <ThreeWireframe src="m" scale={9.5} clockwise={false} />
            </Suspense>
          </div>
          <div class="w-[350px]">
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
      </div>
    </Show>
  );
}
