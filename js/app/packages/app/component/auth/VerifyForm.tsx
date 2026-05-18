import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { isErr } from '@core/util/maybeResult';
import ArrowLeft from '@icon/arrow-left.svg';
import ArrowRight from '@icon/arrow-right.svg';
import { authServiceClient } from '@service-auth/client';
import { action, useAction, useSubmission } from '@solidjs/router';
import { cn } from '@ui';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { sendEmailCode, useResetEmailCode } from './EmailForm';
import { ErrorMsg, Input, Stage } from './Shared';

const verifyCode = action(async (formData: FormData) => {
  const code = formData.get('one-time-code');
  if (typeof code !== 'string') throw new Error('Invalid code');

  const email = formData.get('email');
  if (typeof email !== 'string') throw new Error('Invalid email');

  const maybeResult = await authServiceClient.passwordlessCallback({
    code,
    email,
  });
  const [err] = maybeResult;
  if (err) {
    if (isErr([err], 'UNAUTHORIZED')) {
      throw new Error('Invalid code.');
    }
    throw new Error('Unable to perform verification.');
  }

  return true;
}, 'verify-code');

const RESEND_TIMER = 45;

export function VerifyForm(props: { setStage: (next: Stage) => void }) {
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
      const searchParams = new URLSearchParams(url.search);
      const referral = searchParams.get('referral');
      if (referral) window.location.href = `/app?referral=${referral}`;
    }
  });

  const resetEmailCode = useResetEmailCode(props.setStage);
  let formEl: HTMLFormElement | undefined;

  return (
    <div>
      <form ref={formEl} action={verifyCode} method="post" class="mt-1">
        <div
          class={cn(
            'flex items-center justify-center py-4 px-6 border-b border-edge-muted',
            virtualKeyboardVisible() && 'border-t border-edge-muted'
          )}
        >
          <label
            for="one-time-code"
            class="block text-sm text-ink-muted text-center"
          >
            A 6-digit code has been sent to
            <br />
            <span class="underline text-ink">{email()}</span>
          </label>
        </div>

        <div class="border-b border-edge-muted py-4 px-6 flex flex-none justify-between items-center">
          <Input
            id="one-time-code"
            type="text"
            inputMode="numeric"
            placeholder="Activation Code"
            onInput={(x) => {
              if (x.currentTarget.value.length === 6) {
                const formData = new FormData(formEl);
                formData.set('email', email());
                submit(formData);
              }
            }}
          />
          <button
            class={cn(
              'inline-block font-medium text-accent hover:text-accent/80 transition',
              showResendCode()
                ? 'opacity-100'
                : 'opacity-50 pointer-events-none',
              (emailSubmission.pending || submission.pending) &&
                'opacity-50 pointer-events-none'
            )}
            disabled={
              emailSubmission.pending || submission.pending || !showResendCode()
            }
            onClick={handleResendCode}
            type="button"
          >
            <Show when={resendTimer() > 0} fallback="Resend">
              Resend({resendTimer()}s)
            </Show>
          </button>
        </div>

        <div class="border-b border-edge-muted py-4 px-6 flex flex-none justify-between items-center">
          <button
            class="hover:text-accent hover:transition-none transition-colors duration-300 grid grid-cols-[min-content_min-content] gap-1.5 items-center w-min"
            onClick={resetEmailCode}
            type="button"
          >
            <ArrowLeft class="size-5" />
            <span>Back</span>
          </button>

          <button
            class="hover:text-accent hover:transition-none transition-colors duration-300 grid grid-cols-[min-content_min-content] gap-1.5 items-center w-min"
            type="submit"
            disabled={submission.pending}
          >
            <span>Continue</span>
            <ArrowRight class="size-5" />
          </button>
        </div>

        <ErrorMsg msg={submission.error?.message} />
      </form>

      <ErrorMsg msg={resendError()} />
    </div>
  );
}
