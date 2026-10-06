import ArrowLeft from '@phosphor/arrow-left.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { FormError } from './form-fields';
import { OtpInput } from './otp-input';

export function VerifyForm(props: {
  email: string;
  code: string;
  verifying: boolean;
  canVerify: boolean;
  resendIn: number;
  resending: boolean;
  error?: string;
  onCodeInput: (value: string) => void;
  onVerify: (code?: string) => void;
  onResend: () => void;
  onBack: () => void;
}) {
  return (
    <form
      class="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        props.onVerify();
      }}
    >
      <p class="text-xs text-ink-muted leading-snug">
        Enter the 6-digit code we sent to{' '}
        <span class="text-ink font-medium break-all">{props.email}</span>.
      </p>
      <OtpInput
        value={props.code}
        disabled={props.verifying}
        onInput={props.onCodeInput}
        onComplete={(code) => props.onVerify(code)}
      />
      <p class="text-center text-xs text-ink-muted" aria-live="polite">
        Didn't receive a code?{' '}
        <button
          type="button"
          onClick={() => props.onResend()}
          disabled={props.resending || props.verifying || props.resendIn > 0}
          class="font-medium text-ink transition-colors hover:text-ink-muted disabled:text-ink-extra-muted"
        >
          <Show when={props.resendIn > 0} fallback="Resend">
            Resend ({props.resendIn})
          </Show>
        </button>
      </p>
      <FormError message={props.error} />
      <Button variant="cta" size="xl" type="submit" disabled={!props.canVerify}>
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
