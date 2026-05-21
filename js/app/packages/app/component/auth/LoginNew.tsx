import { useAnalytics } from '@app/component/analytics-context';
import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { GOOGLE_GMAIL_IDP } from '@core/auth/email';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { useEmailLinks } from '@core/email-link';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import { getNativeMobilePlatform } from '@core/util/platform';
import IconApple from '@icon/macro-apple.svg';
import IconGoogle from '@icon/macro-google.svg';
import LogoIcon from '@icon/macro-logo.svg';
import IconMail from '@icon/macro-mail.svg';
import ArrowLeft from '@phosphor/arrow-left.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import { useUserInfo } from '@queries/auth';
import {
  invalidateAllAfterLogin,
  invalidateUserInfo,
} from '@queries/auth/user-info';
import { authServiceClient } from '@service-auth/client';
import {
  action,
  useAction,
  useNavigate,
  useSearchParams,
  useSubmission,
} from '@solidjs/router';
import { Button, cn } from '@ui';
import { Stepper } from '@ui/components/Stepper';
import { detect } from 'detect-browser';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
  splitProps,
  untrack,
} from 'solid-js';
import { sendEmailCode, useResetEmailCode } from './EmailForm';
import { Stage } from './Shared';
import { useSsoLogin } from './useSsoLogin';

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

type ActionButtonVariant = 'primary' | 'secondary';

type ActionButtonProps = {
  icon?: JSX.Element;
  trailingIcon?: JSX.Element;
  children: JSX.Element;
  onClick?: () => void;
  variant?: ActionButtonVariant;
  type?: 'button' | 'submit';
  autofocus?: boolean;
  disabled?: boolean;
  class?: string;
};

const actionButtonVariants: Record<ActionButtonVariant, string> = {
  primary:
    'bg-accent text-surface not-disabled:hover:bg-accent not-disabled:hover:text-surface focus-visible:bg-accent active:outline-accent disabled:bg-ink/30 disabled:text-surface/70 disabled:cursor-not-allowed disabled:hover:outline-transparent',
  secondary:
    'bg-surface text-ink border border-edge hover:border-edge disabled:opacity-50 disabled:cursor-not-allowed',
};

function ActionButton(props: ActionButtonProps) {
  const [local, others] = splitProps(props, [
    'icon',
    'trailingIcon',
    'children',
    'variant',
    'type',
    'onClick',
    'class',
  ]);
  const isSubmit = () => local.type === 'submit';

  return (
    <Button
      {...others}
      type={local.type ?? 'button'}
      onClick={(e) => {
        if (isSubmit()) {
          if (isTouchDevice()) e.preventDefault();
          return;
        }
        if (isTouchDevice()) return;
        local.onClick?.();
      }}
      onPointerDown={(e) => {
        if (!isTouchDevice()) return;
        if (others.disabled) return;
        e.stopPropagation();
        e.preventDefault();
        if (isSubmit()) {
          e.currentTarget.form?.requestSubmit();
        } else {
          local.onClick?.();
        }
      }}
      class={cn(
        'gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        actionButtonVariants[local.variant ?? 'secondary'],
        local.class
      )}
      tabIndex={0}
    >
      <Show when={local.icon}>
        <span class="shrink-0 inline-flex">{local.icon}</span>
      </Show>
      <span>{local.children}</span>
      <Show when={local.trailingIcon}>
        <span class="shrink-0 inline-flex">{local.trailingIcon}</span>
      </Show>
    </Button>
  );
}

function LoginPicker(props: { setStage: (next: Stage) => void }) {
  const startSsoLogin = useSsoLogin();
  const showApple =
    !isNativeMobilePlatform() || getNativeMobilePlatform() === 'ios';

  return (
    <div class="flex flex-col gap-3">
      <ActionButton
        variant="primary"
        autofocus
        icon={<IconGoogle />}
        onClick={() => startSsoLogin(GOOGLE_GMAIL_IDP)}
      >
        Continue with Google
      </ActionButton>

      <Show when={showApple}>
        <ActionButton
          icon={<IconApple />}
          onClick={() => startSsoLogin('Apple')}
        >
          Continue with Apple
        </ActionButton>
      </Show>

      <ActionButton
        icon={<IconMail />}
        onClick={() => props.setStage(Stage.Email)}
      >
        Continue with email
      </ActionButton>
    </div>
  );
}

function FormInput(props: {
  id: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  value?: string;
  inputMode?: 'text' | 'numeric';
  pattern?: string;
  maxLength?: number;
  autoFocus?: boolean;
  monospace?: boolean;
  centered?: boolean;
  class?: string;
  onInput?: JSX.ChangeEventHandlerUnion<HTMLInputElement, Event>;
}) {
  const [el, setEl] = createSignal<HTMLInputElement>();
  onMount(() => {
    if (props.autoFocus === false) return;
    setTimeout(() => el()?.focus(), 1);
  });
  return (
    <input
      ref={setEl}
      id={props.id}
      name={props.id}
      type={props.type ?? 'text'}
      inputMode={props.inputMode}
      pattern={props.pattern}
      placeholder={props.placeholder}
      value={props.value ?? ''}
      required={props.required ?? true}
      maxLength={props.maxLength}
      autocomplete={props.id}
      onInput={props.onInput}
      class={cn(
        'ln-input w-full px-4 py-3 rounded-lg border border-edge bg-surface text-sm text-ink placeholder:text-ink-placeholder focus:border-accent focus:outline-none transition-colors',
        'user-invalid:border-failure',
        props.monospace && 'font-mono tracking-[0.4em] text-base',
        props.centered && 'text-center',
        props.class
      )}
    />
  );
}

function FormError(props: { msg?: string }) {
  return (
    <Show when={props.msg}>
      <p role="alert" class="text-xs text-failure leading-snug">
        {props.msg}
      </p>
    </Show>
  );
}

function EmailFormNew(props: {
  setStage: (next: Stage) => void;
  onBack: () => void;
}) {
  const [isPasswordLogin, setIsPasswordLogin] = createSignal(false);
  const submission = useSubmission(sendEmailCode);
  const [searchParams] = useSearchParams();
  const searchParamsEmail = untrack(() => {
    const email = searchParams.email;
    if (typeof email === 'string') return email;
  });

  createEffect(() => {
    if (submission.result === true) {
      props.setStage(Stage.Verify);
    } else if (submission.result === 'isPasswordLogin') {
      setIsPasswordLogin(true);
    } else if (submission.result === 'LoggedIn') {
      props.setStage(Stage.Done);
    }
  });

  return (
    <form
      action={sendEmailCode}
      method="post"
      noValidate={false}
      class="flex flex-col gap-3"
    >
      <p class="text-xs text-ink-muted leading-snug">
        We’ll send a one-time code to verify.
      </p>
      <FormInput
        id="email"
        type="email"
        placeholder="you@company.com"
        value={searchParamsEmail}
      />
      <Show when={isPasswordLogin()}>
        <FormInput
          id="password"
          type="password"
          placeholder="Password"
          required={isPasswordLogin()}
        />
      </Show>
      <FormError msg={submission.error?.message} />
      <ActionButton
        variant="primary"
        type="submit"
        trailingIcon={<ArrowRight />}
        disabled={submission.pending}
      >
        Continue
      </ActionButton>
      <ActionButton
        type="button"
        variant="secondary"
        icon={<ArrowLeft class="size-4" />}
        onClick={props.onBack}
      >
        Back to sign in
      </ActionButton>
    </form>
  );
}

const verifyCode = action(async (formData: FormData) => {
  const code = formData.get('one-time-code');
  if (typeof code !== 'string') throw new Error('Invalid code');
  const email = formData.get('email');
  if (typeof email !== 'string') throw new Error('Invalid email');

  const result = await authServiceClient.passwordlessCallback({ code, email });
  if (result.isErr()) {
    if (result.error.some((err) => err.code === 'UNAUTHORIZED')) {
      throw new Error('Invalid code.');
    }
    throw new Error('Unable to perform verification.');
  }

  return true;
}, 'verify-code-login-new');

const RESEND_TIMER = 45;

function VerifyFormNew(props: {
  setStage: (next: Stage) => void;
  onBack: () => void;
}) {
  const [resendError, setResendError] = createSignal<string>();
  const [showResendCode, setShowResendCode] = createSignal(false);
  const [resendTimer, setResendTimer] = createSignal(RESEND_TIMER);
  const submission = useSubmission(verifyCode);
  const emailSubmission = useSubmission(sendEmailCode);
  const resend = useAction(sendEmailCode);
  const submit = useAction(verifyCode);

  const email = () => emailSubmission.input?.[0].get('email') as string;

  createEffect(() => {
    if (!showResendCode()) {
      const timer = setTimeout(() => {
        setResendTimer(0);
        setShowResendCode(true);
      }, RESEND_TIMER * 1000);
      const pTimer = setInterval(
        () => setResendTimer((t) => (t > 0 ? t - 1 : 0)),
        1000
      );
      onCleanup(() => {
        clearTimeout(timer);
        clearInterval(pTimer);
      });
    }
  });

  const handleResendCode = async () => {
    submission.clear();
    setResendError();
    setResendTimer(RESEND_TIMER);
    setShowResendCode(false);
    const formData = new FormData();
    formData.append('email', email());
    try {
      await resend(formData);
    } catch (e) {
      console.error(e);
      setResendTimer(0);
      setShowResendCode(true);
      setResendError(
        e instanceof Error
          ? e.message
          : 'Failed to resend code. Please try again.'
      );
    }
  };

  createEffect(() => {
    if (submission.result) {
      props.setStage(Stage.Done);
      const url = new URL(window.location.href);
      const sp = new URLSearchParams(url.search);
      const referral = sp.get('referral');
      if (referral) window.location.href = `/app?referral=${referral}`;
    }
  });

  let formEl: HTMLFormElement | undefined;

  return (
    <form
      ref={formEl}
      action={verifyCode}
      method="post"
      class="flex flex-col gap-3"
    >
      <input type="hidden" name="email" value={email() ?? ''} />
      <p class="text-xs text-ink-muted leading-snug">
        Enter the 6-digit code we sent to{' '}
        <span class="text-ink font-medium break-all">{email()}</span>.
      </p>
      <div class="relative">
        <FormInput
          id="one-time-code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          placeholder="••••••"
          maxLength={6}
          monospace
          centered
          class="pr-20"
          onInput={(e) => {
            const value = e.currentTarget.value;
            if (value.length === 6) {
              const formData = new FormData(formEl);
              formData.set('email', email());
              submit(formData);
            }
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleResendCode}
          disabled={
            emailSubmission.pending || submission.pending || !showResendCode()
          }
          aria-live="polite"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs rounded-lg"
        >
          <Show when={resendTimer() > 0} fallback="Resend">
            {resendTimer()}s
          </Show>
        </Button>
      </div>
      <FormError msg={submission.error?.message ?? resendError()} />
      <ActionButton
        variant="primary"
        type="submit"
        trailingIcon={<ArrowRight />}
        disabled={submission.pending}
      >
        Verify
      </ActionButton>
      <ActionButton
        type="button"
        variant="secondary"
        icon={<ArrowLeft class="size-4" />}
        onClick={props.onBack}
      >
        Change email
      </ActionButton>
    </form>
  );
}

export function LoginNew() {
  const [searchParams] = useSearchParams();
  const [stage, setStage] = createSignal(
    searchParams.email ? Stage.Email : Stage.None
  );
  const userInfo = useUserInfo();
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
    // token may be an array if the redirect URL contained duplicate token params;
    // take the last one as it is the most recently appended by the auth service
    const rawToken = searchParams.token;
    const session_code = Array.isArray(rawToken)
      ? rawToken[rawToken.length - 1]
      : rawToken;
    if (session_code && typeof session_code === 'string') {
      unsetTokenPromise();
      authServiceClient.sessionLogin({ session_code }).then(async (res) => {
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

  const stepIndex = () =>
    stage() === Stage.None ? 0 : stage() === Stage.Email ? 1 : 2;

  const emailSubmission = useSubmission(sendEmailCode);
  const verifySubmission = useSubmission(verifyCode);
  const resetEmailCode = useResetEmailCode(setStage);

  const onBack = () => {
    if (stage() === Stage.Verify) {
      verifySubmission.clear();
      resetEmailCode();
    } else if (stage() === Stage.Email) {
      emailSubmission.clear();
      setStage(Stage.None);
    }
  };

  const headerTitle = createMemo(() => {
    switch (stage()) {
      case Stage.Email:
        return 'Enter your email';
      case Stage.Verify:
        return 'Check your inbox';
      default:
        return 'Log in to Macro';
    }
  });

  return (
    <Show when={!userInfo()?.authenticated} fallback={<PostLoginRedirect />}>
      <div class="flex items-center justify-center size-full overflow-hidden relative">
        <style>{
          /*css*/ `
          @keyframes ln-card-in {
            from { opacity: 0; transform: translateY(14px) scale(0.985); }
            to   { opacity: 1; transform: translateY(0)    scale(1);     }
          }
          .ln-card { animation: ln-card-in 520ms cubic-bezier(0.22, 1, 0.36, 1) both; }

          /* Override browser autofill yellow with our surface/ink palette */
          .ln-input:-webkit-autofill,
          .ln-input:-webkit-autofill:hover,
          .ln-input:-webkit-autofill:focus,
          .ln-input:-webkit-autofill:active {
            -webkit-box-shadow: 0 0 0 1000px var(--color-surface) inset;
            -webkit-text-fill-color: var(--color-ink);
            caret-color: var(--color-ink);
            transition: background-color 5000s ease-in-out 0s;
          }
        `
        }</style>

        <div class="w-full max-w-sm sm:max-w-md ln-card">
          <div class="px-4 sm:px-8 flex flex-col gap-16">
            <div class="flex flex-col gap-8">
              <Show when={!virtualKeyboardVisible()}>
                <div class="flex flex-col items-center text-center gap-2">
                  <LogoIcon class="shrink-0 text-accent size-10" />
                  <h1
                    class={cn('font-semibold tracking-tight text-ink text-2xl')}
                  >
                    {headerTitle()}
                  </h1>
                </div>
              </Show>

              <Stepper
                step={stepIndex()}
                transition={Stepper.transitions.scale}
              >
                <Stepper.Step>
                  <div class="flex flex-col gap-8">
                    <LoginPicker setStage={onStageChange} />
                    <div class="flex justify-center gap-2 text-sm">
                      <div class="text-ink/50">New to Macro?</div>
                      <a
                        class="text-ink hover:text-accent focus-visible:text-accent"
                        href={`${ROUTER_BASE_CONCAT}signup`}
                        tabindex={0}
                      >
                        Create an account
                      </a>
                    </div>
                  </div>
                </Stepper.Step>
                <Stepper.Step>
                  <EmailFormNew setStage={onStageChange} onBack={onBack} />
                </Stepper.Step>
                <Stepper.Step>
                  <VerifyFormNew setStage={onStageChange} onBack={onBack} />
                </Stepper.Step>
              </Stepper>
            </div>

            <div class="flex flex-col text-center text-xs text-ink-muted">
              <div class="text-ink/50 wrap-break-word">
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
        </div>
      </div>
    </Show>
  );
}
