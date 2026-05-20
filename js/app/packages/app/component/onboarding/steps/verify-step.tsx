import { SERVER_HOSTS } from '@core/constant/servers';
import { initAndStartEmailSync } from '@core/email-link';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import { platformFetch } from '@core/util/platformFetch';
import SpinnerIcon from '@phosphor/spinner.svg';
import { invalidateAllAfterLogin } from '@queries/auth/user-info';
import { authServiceClient } from '@service-auth/client';
import { cn } from '@ui';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { useOnboarding } from '../onboarding-context';

const RESEND_TIMER = 45;

const protocol = import.meta.hot ? 'http' : 'https';
const REDIRECT_URI = `${protocol}://${window.location.host}/app`;

export function VerifyStep() {
  const ctx = useOnboarding();

  const [code, setCode] = createSignal('');
  const [error, setError] = createSignal<string>();
  const [verifying, setVerifying] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [resendTimer, setResendTimer] = createSignal(RESEND_TIMER);

  let resendIntervalId: ReturnType<typeof setInterval> | undefined;

  const startTimer = () => {
    if (resendIntervalId) clearInterval(resendIntervalId);
    setResendTimer(RESEND_TIMER);
    resendIntervalId = setInterval(
      () => setResendTimer((t) => (t > 0 ? t - 1 : 0)),
      1000
    );
  };

  onCleanup(() => {
    if (resendIntervalId) clearInterval(resendIntervalId);
  });

  const sendCode = async () => {
    setSending(true);
    setError(undefined);

    try {
      const url = new URL(window.location.href);
      const referralCode = url.searchParams.get('referral_code');

      const response = await platformFetch(
        `${SERVER_HOSTS['auth-service']}/login/passwordless`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            redirect_uri: REDIRECT_URI,
            email: ctx.email(),
            ...(referralCode && { referral_code: referralCode }),
          }),
        }
      );

      if (!response.ok) {
        throw new Error(await response.text());
      }

      if (response.status === 202) {
        setError(
          'This email requires a different sign-in method. Please use Google instead.'
        );
        return;
      }

      startTimer();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send code.');
    } finally {
      setSending(false);
    }
  };

  onMount(() => {
    sendCode();
  });

  const handleVerify = async () => {
    const value = code().trim();
    if (value.length !== 6) return;

    setVerifying(true);
    setError(undefined);

    try {
      const result = await authServiceClient.passwordlessCallback({
        code: value,
        email: ctx.email(),
      });

      if (result.isErr()) {
        if (result.error.some((e) => e.code === 'UNAUTHORIZED')) {
          setError('Invalid code. Please try again.');
        } else {
          setError('Verification failed. Please try again.');
        }
        setVerifying(false);
        return;
      }

      unsetTokenPromise();
      await invalidateAllAfterLogin();

      initAndStartEmailSync().match(
        () => {},
        (e) => {
          if (e.tag !== 'AlreadyInitialized') {
            console.error('Failed to init email link after verify', e);
          }
        }
      );

      if (ctx.firstName() || ctx.lastName()) {
        authServiceClient
          .putUserName({
            first_name: ctx.firstName() || undefined,
            last_name: ctx.lastName() || undefined,
          })
          .catch(() => {});
      }

      ctx.next();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed.');
      setVerifying(false);
    }
  };

  const handleCodeInput = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    setError(undefined);

    if (digits.length === 6) {
      handleVerify();
    }
  };

  const canResend = () => !sending() && resendTimer() === 0;

  const inputClass = cn(
    'w-full px-2.5 h-9 text-sm rounded-sm border bg-transparent text-ink placeholder:text-ink-placeholder transition-colors text-center tracking-widest font-mono',
    'outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 focus:ring-offset-surface',
    'border-edge-muted'
  );

  return (
    <div class="flex flex-col gap-8 w-full mobile:h-full">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold text-ink tracking-tight">
          Verify your email
        </h1>
        <p class="text-sm text-ink-disabled">
          <Show when={!sending()} fallback="Sending a code to ">
            We sent a 6-digit code to{' '}
          </Show>
          <strong class="text-ink font-medium">{ctx.email()}</strong>
        </p>
      </div>

      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <label for="onb-otp" class="text-sm font-medium text-ink">
            Verification code
          </label>
          <input
            id="onb-otp"
            type="text"
            inputMode="numeric"
            value={code()}
            onInput={(e) => handleCodeInput(e.currentTarget.value)}
            placeholder="000000"
            disabled={verifying() || sending()}
            class={inputClass}
            autocomplete="one-time-code"
          />
        </div>

        <Show when={error()}>
          <p class="text-xs text-failure text-center">{error()}</p>
        </Show>

        <Show when={verifying()}>
          <div class="flex items-center justify-center gap-2 text-sm text-ink-muted">
            <SpinnerIcon class="size-4 animate-spin" />
            Verifying...
          </div>
        </Show>
      </div>

      <div class="flex items-center justify-center mobile:mt-auto">
        <button
          type="button"
          tabIndex={0}
          onClick={sendCode}
          disabled={!canResend()}
          class={cn(
            'text-xs transition-colors outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
            canResend()
              ? 'text-accent hover:text-accent/80'
              : 'text-ink-disabled'
          )}
        >
          <Show when={resendTimer() > 0} fallback="Resend code">
            Resend in {resendTimer()}s
          </Show>
        </button>
      </div>
    </div>
  );
}
