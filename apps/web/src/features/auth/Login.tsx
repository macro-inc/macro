import { OnboardingFlow } from '@app/features/setup/flow/OnboardingFlow';
import { NoiseBackground } from '@app/features/setup/flow/shared';
import { useOnboardingV4Flag } from '@app/features/setup/flow/useOnboardingV4Flag';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { GOOGLE_GMAIL_IDP } from '@core/auth/email';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { toast } from '@core/component/Toast/Toast';
import { useEmailLinks } from '@core/email-link';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import { getNativeMobilePlatform } from '@core/util/platform';
import IconApple from '@icon/macro-apple.svg';
import IconGoogle from '@icon/macro-google.svg';
import LogoIcon from '@icon/macro-logo.svg';
import ArrowLeft from '@phosphor/arrow-left.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import { useUserInfo } from '@queries/auth';
import {
  invalidateAllAfterLogin,
  useUserInfoQuery,
} from '@queries/auth/user-info';
import { authServiceClient } from '@service-auth/client';
import {
  action,
  useAction,
  useNavigate,
  useSearchParams,
  useSubmission,
} from '@solidjs/router';
import { Button } from '@ui';
import { Stepper } from '@ui/components/Stepper';
import { detect } from 'detect-browser';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  autoLoginCode,
  sendEmailCode,
  sentEmailCode,
  useResetEmailCode,
} from './EmailForm';
import { OtpInput } from './OtpInput';
import { Stage } from './Shared';
import { useSsoLogin } from './useSsoLogin';

function PostLoginRedirect() {
  const navigate = useNavigate();

  // Login init is owned by the per-method handlers (the session-token effect and
  // onComplete); this redirect only navigates, so login doesn't fire init twice.
  onMount(() => {
    navigate('/', { replace: true });
  });

  return <LoadingBlock />;
}

/**
 * Where login and onboarding meet: once authenticated, first-time desktop
 * users continue straight into the onboarding steps IN PLACE — same page,
 * no redirect — while everyone else proceeds into the app. This keeps
 * /login a single surface that decides what the user needs next.
 */
function PostAuthGate() {
  const userInfoQuery = useUserInfoQuery();
  const onboardingV4 = useOnboardingV4Flag();

  const isFirstTimeDesktopUser = () =>
    !isMobile() &&
    !isNativeMobilePlatform() &&
    userInfoQuery.data?.authenticated === true &&
    userInfoQuery.data.tutorialComplete === false;

  const needsOnboarding = () =>
    onboardingV4().enabled && isFirstTimeDesktopUser();

  // Don't redirect into the app while the gate is still unknown: a first-time
  // user would land on home for a beat and then get yanked to /onboarding.
  const waitingOnFlag = () =>
    onboardingV4().loading && isFirstTimeDesktopUser();

  return (
    <Suspense fallback={<LoadingBlock />}>
      <Show when={userInfoQuery.data} fallback={<LoadingBlock />}>
        <Show when={!waitingOnFlag()} fallback={<LoadingBlock />}>
          <Show when={needsOnboarding()} fallback={<PostLoginRedirect />}>
            <OnboardingFlow />
          </Show>
        </Show>
      </Show>
    </Suspense>
  );
}

function LoginPicker(props: {
  setStage: (next: Stage) => void;
  signupMode?: boolean;
}) {
  const analytics = useAnalytics();
  const startSsoLogin = useSsoLogin({ signupMode: props.signupMode });
  // Apple sign-in is iOS-only: it's required there for App Store review,
  // and intentionally absent on desktop.
  const showApple = getNativeMobilePlatform() === 'ios';

  const continueWithEmail = () => {
    if (props.signupMode) {
      analytics.track('sign_up_click', { method: 'email' });
    }
    props.setStage(Stage.Email);
  };

  return (
    <div class="flex flex-col gap-3">
      <Button
        variant="cta"
        size="xl"
        autofocus
        onClick={() => startSsoLogin(GOOGLE_GMAIL_IDP)}
      >
        <IconGoogle class="size-fit" />
        Continue with Google
      </Button>

      <Show when={showApple}>
        <Button
          variant="outline"
          size="xl"
          class="bg-surface"
          onClick={() => startSsoLogin('Apple')}
        >
          <IconApple class="size-fit" />
          Continue with Apple
        </Button>
      </Show>

      <Button
        variant="outline"
        size="xl"
        class="bg-surface"
        onClick={continueWithEmail}
      >
        Continue with email
      </Button>
    </div>
  );
}

function FormInput(props: {
  id: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  value?: string;
  autoFocus?: boolean;
}) {
  let inputEl: HTMLInputElement | undefined;
  onMount(() => {
    if (props.autoFocus === false) return;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    // The Stepper's outin Transition resolves this step's JSX (firing onMount)
    // before attaching it to the document, so the input is still detached
    // here. Poll until it's connected, then focus.
    const focusWhenConnected = () => {
      if (cancelled || !inputEl) return;
      if (inputEl.isConnected) inputEl.focus({ preventScroll: true });
      else requestAnimationFrame(focusWhenConnected);
    };
    focusWhenConnected();
  });
  return (
    <input
      ref={(el) => (inputEl = el)}
      id={props.id}
      name={props.id}
      type={props.type ?? 'text'}
      placeholder={props.placeholder}
      value={props.value ?? ''}
      required={props.required ?? true}
      autocomplete={props.id}
      class="ln-input w-full px-4 py-3 rounded-lg border border-edge bg-surface text-sm text-ink placeholder:text-ink-placeholder focus:border-accent focus:outline-none transition-colors user-invalid:border-failure"
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
  const send = useAction(sendEmailCode);
  const [searchParams] = useSearchParams();
  const searchParamsEmail = untrack(() => {
    const email = searchParams.email;
    if (typeof email === 'string') return email;
  });

  // Dev builds auto-start the flow for `?email=` links (the seeder prints
  // them per persona); combined with the local backend returning the code,
  // opening the link logs straight in.
  createEffect(() => {
    if (
      import.meta.env.DEV &&
      searchParamsEmail &&
      !submission.pending &&
      !submission.result &&
      !submission.error
    ) {
      const formData = new FormData();
      formData.append('email', searchParamsEmail);
      send(formData);
    }
  });

  createEffect(() => {
    if (sentEmailCode(submission.result)) {
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
      <Button
        variant="cta"
        size="xl"
        type="submit"
        disabled={submission.pending}
      >
        Continue
        <ArrowRight class="size-5" />
      </Button>
      <Button
        variant="outline"
        size="xl"
        class="bg-surface"
        onClick={props.onBack}
      >
        <ArrowLeft class="size-5" />
        Back to sign in
      </Button>
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
  const [code, setCode] = createSignal('');
  const [resendError, setResendError] = createSignal<string>();
  const [showResendCode, setShowResendCode] = createSignal(false);
  const [resendTimer, setResendTimer] = createSignal(RESEND_TIMER);
  const submission = useSubmission(verifyCode);
  const emailSubmission = useSubmission(sendEmailCode);
  const resend = useAction(sendEmailCode);
  const submit = useAction(verifyCode);

  const email = () => {
    const value = emailSubmission.input?.[0].get('email');
    return typeof value === 'string' ? value : undefined;
  };

  // Local backends return the code with the email step; submit it
  // automatically so seeded persona logins are one click.
  createEffect(() => {
    const code = autoLoginCode(emailSubmission.result);
    const submittedEmail = email();
    if (
      code &&
      submittedEmail &&
      !submission.pending &&
      !submission.result &&
      !submission.error
    ) {
      const formData = new FormData();
      formData.append('email', submittedEmail);
      formData.append('one-time-code', code);
      submit(formData);
    }
  });

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
    const submittedEmail = email();
    if (!submittedEmail) {
      setResendError('Email address is unavailable. Go back and try again.');
      return;
    }
    submission.clear();
    setResendError();
    setResendTimer(RESEND_TIMER);
    setShowResendCode(false);
    const formData = new FormData();
    formData.append('email', submittedEmail);
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
      <input type="hidden" name="one-time-code" value={code()} />
      <p class="text-xs text-ink-muted leading-snug">
        Enter the 6-digit code we sent to{' '}
        <span class="text-ink font-medium break-all">{email()}</span>.
      </p>
      <OtpInput
        value={code()}
        disabled={submission.pending}
        onInput={setCode}
        onComplete={(value) => {
          const submittedEmail = email();
          if (!submittedEmail) return;
          const formData = new FormData(formEl);
          formData.set('email', submittedEmail);
          formData.set('one-time-code', value);
          submit(formData);
        }}
      />
      <p class="text-center text-xs text-ink-muted" aria-live="polite">
        Didn't receive a code?{' '}
        <button
          type="button"
          onClick={handleResendCode}
          disabled={
            emailSubmission.pending ||
            submission.pending ||
            !showResendCode() ||
            !email()
          }
          class="font-medium text-ink transition-colors hover:text-ink-muted disabled:text-ink-extra-muted"
        >
          <Show when={resendTimer() > 0} fallback="Resend">
            Resend ({resendTimer()})
          </Show>
        </button>
      </p>
      <FormError msg={submission.error?.message ?? resendError()} />
      {/* The visible pattern-validated input is gone (the code lives in a
          hidden field, which browsers exempt from constraint validation), so
          gate submission here instead of round-tripping partial codes. */}
      <Button
        variant="cta"
        size="xl"
        type="submit"
        disabled={submission.pending || code().length !== 6 || !email()}
      >
        Verify
        <ArrowRight class="size-5" />
      </Button>
      <Button
        variant="outline"
        size="xl"
        class="bg-surface"
        onClick={props.onBack}
      >
        <ArrowLeft class="size-5" />
        Change email
      </Button>
    </form>
  );
}

export function Login(props: { signupMode?: boolean }) {
  const [searchParams] = useSearchParams();
  const [stage, setStage] = createSignal(
    searchParams.email ? Stage.Email : Stage.None
  );
  const userInfo = useUserInfo();
  const analytics = useAnalytics();
  const authenticatedUserId = createMemo(() => {
    const user = userInfo();
    return user?.authenticated ? user.id : undefined;
  });

  onMount(() => {
    analytics.pageView(props.signupMode ? 'signup' : 'login');
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

  createEffect(
    on(authenticatedUserId, (userId) => {
      if (userId) identifyUser();
    })
  );

  createEffect(() => {
    // token may be an array if the redirect URL contained duplicate token params;
    // take the last one as it is the most recently appended by the auth service
    const rawToken = searchParams.token;
    const session_code = Array.isArray(rawToken)
      ? rawToken[rawToken.length - 1]
      : rawToken;
    if (session_code && typeof session_code === 'string') {
      authServiceClient.sessionLogin({ session_code }).then(async (res) => {
        if (res.isOk()) {
          // Reset token state only after the session cookies have actually
          // changed — resetting before sessionLogin opens a window where a
          // visibility-triggered refresh re-latches under the new generation.
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
        } else {
          console.error('Failed to redeem session code', res.error);
          toast.failure('Sign-in failed. Please try again.');
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
    match(stage())
      .with(Stage.None, () => 0)
      .with(Stage.Email, () => 1)
      .with(Stage.Verify, () => 2)
      .with(Stage.Done, () => 2)
      .exhaustive();

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

  return (
    <Show when={!userInfo()?.authenticated} fallback={<PostAuthGate />}>
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

        <NoiseBackground />

        <div class="relative z-10 w-full max-w-sm sm:max-w-lg ln-card">
          <div class="px-4 sm:px-8 flex flex-col gap-12">
            <div class="flex flex-col gap-8">
              <Show when={!virtualKeyboardVisible()}>
                <div class="flex flex-col gap-1.5">
                  <LogoIcon class="mb-2 size-9 text-accent" />
                  <h1 class="font-semibold tracking-tight text-ink text-2xl">
                    Welcome to Macro
                  </h1>
                  <p class="text-sm text-ink-muted">
                    The open source workspace
                  </p>
                </div>
              </Show>

              <Stepper
                step={stepIndex()}
                transition={Stepper.transitions.scale}
              >
                <Stepper.Step>
                  <LoginPicker
                    setStage={onStageChange}
                    signupMode={props.signupMode}
                  />
                </Stepper.Step>
                <Stepper.Step>
                  <EmailFormNew setStage={onStageChange} onBack={onBack} />
                </Stepper.Step>
                <Stepper.Step>
                  <VerifyFormNew setStage={onStageChange} onBack={onBack} />
                </Stepper.Step>
              </Stepper>
            </div>

            <div class="text-center text-xs text-ink/50 wrap-break-word">
              By continuing, you agree to our{' '}
              <a
                class="text-link hover:text-link-hover visited:text-link-visited underline underline-offset-2 focus-visible:text-link-hover"
                href="/terms"
              >
                terms
              </a>{' '}
              and{' '}
              <a
                class="text-link hover:text-link-hover visited:text-link-visited underline underline-offset-2 focus-visible:text-link-hover"
                href="/privacy"
              >
                privacy policy
              </a>
              .
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
