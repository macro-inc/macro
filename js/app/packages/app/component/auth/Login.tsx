import {
  updateUserAuth,
  useAuthUserInfo,
  useIsAuthenticated,
} from '@core/auth';
import { ENABLE_NAME_IN_LOGIN } from '@core/constant/featureFlags';
import { setActiveModal } from '@core/signal/activeModal';
import type { RedirectLocation } from '@core/util/authRedirect';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import { isOk } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import { gqlServiceClient, updateUserInfo } from '@service-gql/client';
import { Navigate, useLocation, useSearchParams } from '@solidjs/router';
import {
  createEffect,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { updateCookie } from '../../util/updateCookie';
import { EmailForm } from './EmailForm';
import { LoginOptions } from './LoginOptions';
import { checkAffiliate, Input, identifyUser, Stage } from './Shared';
import ThreeWireframe from './ThreeWireframe';
import { VerifyForm } from './VerifyForm';

export function Login() {
  const [, { refetch: refetchAuthUserInfo }] = useAuthUserInfo();
  const [stage, setStage] = createSignal(Stage.None);
  const location = useLocation<RedirectLocation>();
  const authenticated = useIsAuthenticated();
  const [searchParams] = useSearchParams();

  createEffect(() => {
    if (authenticated()) {
      identifyUser();
      checkAffiliate();
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
      authServiceClient.getUserInfo.invalidate();
      gqlServiceClient.getUserInfo.invalidate();
      authServiceClient.sessionLogin({ session_code }).then((res) => {
        console.log({ res });
        if (isOk(res)) {
          updateUserAuth();
          updateUserInfo();
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
    gqlServiceClient.getUserInfo.invalidate();
    authServiceClient.getUserInfo.invalidate();
    const [err, userInfo] = (await refetchAuthUserInfo()) ?? [];
    if (
      !err &&
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
      <div class="grid w-full h-[100dvh] items-center justify-center font-mono text-[15px]">
        <div class="grid w-min bg-[var(--color-surface)]">
          {ENABLE_NAME_IN_LOGIN && (
            <div class="flex py-2 border-edge items-end justify-start overflow-hidden">
              <Input id="name" placeholder="Your full name" />
            </div>
          )}
          <div class="border border-dashed border-[var(--color-ink)] box-border w-[350px]">
            <ThreeWireframe src="m" scale={9.5} clockwise={false} />
          </div>
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
    </Show>
  );
}
