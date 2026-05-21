import { useAnalytics } from '@app/component/analytics-context';
import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { GOOGLE_GMAIL_IDP } from '@core/auth/email';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import { useEmailLinks } from '@core/email-link';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import { getNativeMobilePlatform } from '@core/util/platform';
import IconApple from '@icon/macro-apple.svg';
import IconGoogle from '@icon/macro-google.svg';
import LogoIcon from '@icon/macro-logo.svg';
import IconMail from '@icon/macro-mail.svg';
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
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { EmailForm } from './EmailForm';
import { Stage } from './Shared';
import { useSsoLogin } from './useSsoLogin';
import { VerifyForm } from './VerifyForm';

function PostLoginRedirect() {
  const navigate = useNavigate();
  const { initEmailLink } = useEmailLinks();

  onMount(async () => {
    await initEmailLink().match(
      () => {},
      (err) => {
        if (err.tag !== 'AlreadyInitialized') {
          console.error('Failed to init email link on login', err);
        }
      }
    );
    navigate('/', { replace: true });
  });

  return <LoadingBlock />;
}

function ProviderButton(props: {
  icon: JSX.Element;
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}) {
  const isPrimary = () => props.variant === 'primary';
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={cn(
        'flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        isPrimary()
          ? 'bg-ink text-surface outline-2 outline-transparent hover:outline-accent active:outline-accent'
          : 'bg-surface text-ink border border-edge hover:border-edge hover:bg-hover/50'
      )}
      autofocus
      tabIndex={0}
    >
      <span class="shrink-0 inline-flex">{props.icon}</span>
      <span class="flex-1 text-left">{props.label}</span>
    </button>
  );
}

function LoginPicker(props: { setStage: (next: Stage) => void }) {
  const startSsoLogin = useSsoLogin();
  const showApple =
    !isNativeMobilePlatform() || getNativeMobilePlatform() === 'ios';

  return (
    <div class="flex flex-col gap-4">
      <ProviderButton
        variant="primary"
        icon={<IconGoogle />}
        label="Continue with Google"
        onClick={() => startSsoLogin(GOOGLE_GMAIL_IDP)}
      />

      <div class="flex items-center gap-3 text-[11px] uppercase tracking-wider text-ink-muted">
        <span class="flex-1 h-px bg-edge-muted" />
        <span>or</span>
        <span class="flex-1 h-px bg-edge-muted" />
      </div>

      <div class="flex flex-col gap-2">
        <Show when={showApple}>
          <ProviderButton
            icon={<IconApple />}
            label="Continue with Apple"
            onClick={() => startSsoLogin('Apple')}
          />
        </Show>
        <ProviderButton
          icon={<IconMail />}
          label="Continue with email"
          onClick={() => props.setStage(Stage.Email)}
        />
      </div>
    </div>
  );
}

export function LoginNew() {
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
          @keyframes ln-card-in {
            from { opacity: 0; transform: translateY(14px) scale(0.985); }
            to   { opacity: 1; transform: translateY(0)    scale(1);     }
          }
          .ln-card { animation: ln-card-in 520ms cubic-bezier(0.22, 1, 0.36, 1) both; }

        `
        }</style>

        <div class="inset-0 absolute text-ink bg-surface opacity-30 -z-1">
          <PcNoiseGrid
            cellSize={20}
            warp={20}
            crunch={0.1}
            freq={0.0002}
            size={[0, 0.01]}
            rounding={0}
            fill={0}
            stroke={1}
            speed={[0.01, 0.509]}
          />
        </div>

        <div class="w-full max-w-md ln-card">
          <Surface active class="rounded-2xl" depth={2}>
            <div
              class={cn(
                'p-8 flex flex-col gap-16',
                stage() === Stage.Email && 'gap-8'
              )}
            >
              <div
                class={cn(
                  'flex flex-col gap-4 items-center',
                  virtualKeyboardVisible() && 'hidden',
                  stage() === Stage.Email && 'flex-row'
                )}
              >
                <LogoIcon
                  class={cn(
                    'size-8 text-accent',
                    stage() === Stage.Email && 'size-6'
                  )}
                />
                <span
                  class={cn(
                    'text-3xl font-bold tracking-wide text-ink',
                    stage() === Stage.Email && 'text-lg'
                  )}
                >
                  <Show
                    when={stage() !== Stage.Email}
                    fallback={'Enter your email'}
                  >
                    Login to Macro
                  </Show>
                </span>
              </div>

              <div class="flex flex-col gap-4">
                <Switch>
                  <Match when={stage() === Stage.None}>
                    <LoginPicker setStage={onStageChange} />
                    <div class="flex gap-2 text-sm">
                      <div>New to Macro?</div>
                      <a
                        class="text-ink underline underline-offset-2 hover:text-accent focus-visible:text-accent"
                        href={`${ROUTER_BASE_CONCAT}signup`}
                        tabindex={0}
                      >
                        Create an account
                      </a>
                    </div>
                  </Match>
                  <Match when={stage() === Stage.Email}>
                    <EmailForm setStage={onStageChange} />
                  </Match>
                  <Match when={stage() === Stage.Verify}>
                    <VerifyForm setStage={onStageChange} />
                  </Match>
                </Switch>
              </div>

              <div class="flex flex-col text-center text-xs text-ink-muted">
                <div class="text-ink/50">
                  By continuing, you agree to our{' '}
                  <a
                    class="underline underline-offset-2 hover:text-ink focus-visible:text-ink"
                    href="/terms"
                  >
                    terms
                  </a>{' '}
                  and{' '}
                  <a
                    class="underline underline-offset-2 hover:text-ink focus-visible:text-ink"
                    href="/privacy"
                  >
                    privacy policy
                  </a>
                  .
                </div>
              </div>
            </div>
          </Surface>
        </div>
      </div>
    </Show>
  );
}
