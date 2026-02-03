import { useIsAuthenticated } from '@core/auth';
import { cn } from '@ui/utils/classname';
import { setActiveModal } from '@core/signal/activeModal';
import type { RedirectLocation } from '@core/util/authRedirect';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import { isOk } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import { fetchUserInfo, invalidateUserInfo } from '@queries/auth/user-info';
import { Navigate, useLocation, useSearchParams } from '@solidjs/router';
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
import { updateCookie } from '@core/util/cookies';
import { EmailForm } from './EmailForm';
import { LoginOptions } from './LoginOptions';
import { identifyUser, Stage } from './Shared';
import { VerifyForm } from './VerifyForm';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';

// Lazy load ThreeWireframe to keep three.js out of main bundle
const ThreeWireframe = lazy(() => import('./ThreeWireframe'));

export function Login() {
  const [stage, setStage] = createSignal(Stage.None);
  const location = useLocation<RedirectLocation>();
  const authenticated = useIsAuthenticated();
  const [searchParams] = useSearchParams();

  createEffect(() => {
    if (authenticated()) {
      identifyUser();
    }
  });

  createEffect(() => {
    if (searchParams.email) {
      setStage(Stage.Email);
    }
    // block copied from Mobile.tsx
    if (
      searchParams.session_code &&
      typeof searchParams.session_code === 'string'
    ) {
      const session_code = searchParams.session_code;
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
    const currentDate = new Date();
    const oneYearFromNow = new Date(
      currentDate.setFullYear(currentDate.getFullYear() + 1)
    );
    setActiveModal();
    unsetTokenPromise();
    invalidateUserInfo();
    const userInfo = await fetchUserInfo();
    if (
      userInfo?.authenticated &&
      location.state?.originalLocation &&
      location.state.originalLocation.pathname !== location.pathname
    ) {
      updateCookie('login', 'true', {
        expires: oneYearFromNow,
        maxAge: 31536000, // one year in seconds
        sameSite: 'Lax',
        path: '/',
      });
      await identifyUser();
    }
  };

  onCleanup(() => {
    setStage(Stage.Email);
  });

  createEffect(() => {
    if (stage() === Stage.Done) {
      onComplete();
    }
  });

  return (
    <Show when={!authenticated()} fallback={<Navigate href="/" />}>
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
                <LoginOptions setStage={setStage} />
              </Match>
              <Match when={stage() === Stage.Email}>
                <EmailForm setStage={setStage} />
              </Match>
              <Match when={stage() === Stage.Verify}>
                <VerifyForm setStage={setStage} />
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </Show>
  );
}
