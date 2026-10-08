import ArrowLeft from '@phosphor/arrow-left.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { FormError, FormInput } from './form-fields';

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
      <Button variant="cta" size="xl" type="submit" disabled={props.sending}>
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
