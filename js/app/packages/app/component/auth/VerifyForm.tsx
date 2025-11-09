import { isErr } from '@core/util/maybeResult';
import ArrowLeft from '@icon/regular/arrow-left.svg';
import ArrowRight from '@icon/regular/arrow-right.svg';
import { authServiceClient } from '@service-auth/client';
import { action, useAction, useSubmission } from '@solidjs/router';
import {
  createEffect,
  createSignal,
  onCleanup,
  type Setter,
  Show,
} from 'solid-js';
import { sendEmailCode, useResetEmailCode } from './EmailForm';
import { checkAffiliate, ErrorMsg, Input, identifyUser, Stage } from './Shared';

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

  await identifyUser();
  checkAffiliate();

  const url = new URL(window.location.href);
  const searchParams = new URLSearchParams(url.search);
  const referral = searchParams.get('referral');
  if (referral) window.location.href = `/app?referral=${referral}`;

  return true;
}, 'verify-code');

const RESEND_TIMER = 45;

export function VerifyForm(props: { setStage: Setter<Stage> }) {
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
    if (submission.result) props.setStage(Stage.Done);
  });

  const resetEmailCode = useResetEmailCode(props.setStage);
  let formEl: HTMLFormElement | undefined;

  return (
    <div>
      <form ref={formEl} action={verifyCode} method="post" class="mt-1">
        <div class="grid items-center justify-center pt-5 pr-10 pb-5 pl-10 border border-dashed border-ink border-t-0">
          <label for="one-time-code" class="block text-sm font-medium text-ink">
            A 6-digit code has been sent to
            <br />
            <span class="underline">{email()}</span>
          </label>
        </div>

        <div class="border border-dashed border-ink border-t-0 py-5 px-10 flex flex-none justify-between items-center">
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
            class={`inline-block font-medium text-accent-ink hover:text-accent-ink/80 cursor-default transition 
              ${showResendCode() ? 'opacity-100 cursor-pointer' : 'opacity-50 pointer-events-none cursor-not-allowed'} 
              ${emailSubmission.pending || submission.pending ? 'opacity-50 cursor-not-allowed' : ''}`}
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

        <div class="border border-dashed border-ink border-t-0 py-5 px-10 flex flex-none justify-between items-center">
          <button
            class="hover:text-accent hover:transition-none cursor-pointer transition-colors duration-300 grid grid-cols-[min-content_min-content] items-center w-min"
            onClick={resetEmailCode}
            type="button"
          >
            <ArrowLeft class="w-5 h-5" />
            <span>Back</span>
          </button>

          <button
            class="hover:text-accent hover:transition-none cursor-pointer transition-colors duration-300 grid grid-cols-[min-content_min-content] items-center w-min"
            type="submit"
            disabled={submission.pending}
          >
            <span>Continue</span>
            <ArrowRight class="w-5 h-5" />
          </button>
        </div>

        <ErrorMsg msg={submission.error?.message} />
      </form>

      <ErrorMsg msg={resendError()} />
    </div>
  );
}
