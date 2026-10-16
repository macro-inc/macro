import IconApple from '@icon/macro-apple.svg';
import IconGoogle from '@icon/macro-google.svg';
import { Show } from 'solid-js';
import { AuthButton } from './form-fields';

export function LoginPicker(props: {
  /** Sign in with Apple is required for App Store review and iOS-only. */
  showApple: boolean;
  onGoogle: () => void;
  onApple: () => void;
  onEmail: () => void;
}) {
  return (
    <div class="flex flex-col gap-3">
      <AuthButton autofocus onClick={props.onGoogle}>
        <IconGoogle
          viewBox="0 0 24 24"
          class="size-5 shrink-0"
          fill="currentColor"
          stroke="none"
          aria-hidden="true"
        />
        Continue with Google
      </AuthButton>
      <Show when={props.showApple}>
        <AuthButton variant="secondary" onClick={props.onApple}>
          <IconApple class="size-5 shrink-0" aria-hidden="true" />
          Continue with Apple
        </AuthButton>
      </Show>
      <AuthButton variant="secondary" onClick={props.onEmail}>
        Continue with email
      </AuthButton>
    </div>
  );
}
