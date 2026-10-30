import ArrowLeft from '@icon/system/regular/arrow-left.svg';
import ArrowRight from '@icon/system/regular/arrow-right.svg';
import { Show } from 'solid-js';
import { AuthButton, FormError, FormInput } from './form-fields';

export function EmailForm(props: {
  email: string;
  password: string;
  passwordRequired: boolean;
  sending: boolean;
  error?: string;
  onEmailInput: (value: string) => void;
  onPasswordInput: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <form
      class="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <p class="text-xs text-ink-muted leading-snug">
        We’ll send a one-time code to verify.
      </p>
      <FormInput
        id="email"
        type="email"
        placeholder="you@company.com"
        value={props.email}
        onInput={props.onEmailInput}
      />
      <Show when={props.passwordRequired}>
        <FormInput
          id="password"
          type="password"
          placeholder="Password"
          value={props.password}
          onInput={props.onPasswordInput}
        />
      </Show>
      <FormError message={props.error} />
      <AuthButton type="submit" disabled={props.sending}>
        Continue
        <ArrowRight class="size-5 shrink-0" />
      </AuthButton>
      <AuthButton variant="secondary" onClick={props.onBack}>
        <ArrowLeft class="size-5 shrink-0" />
        Back to sign in
      </AuthButton>
    </form>
  );
}
