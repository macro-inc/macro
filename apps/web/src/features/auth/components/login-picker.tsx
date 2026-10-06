import IconApple from '@icon/macro-apple.svg';
import IconGoogle from '@icon/macro-google.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';

export function LoginPicker(props: {
  /** Sign in with Apple is required for App Store review and iOS-only. */
  showApple: boolean;
  onGoogle: () => void;
  onApple: () => void;
  onEmail: () => void;
}) {
  return (
    <div class="flex flex-col gap-3">
      <Button variant="cta" size="xl" autofocus onClick={props.onGoogle}>
        <IconGoogle class="size-fit" />
        Continue with Google
      </Button>
      <Show when={props.showApple}>
        <Button
          variant="outline"
          size="xl"
          class="bg-surface"
          onClick={props.onApple}
        >
          <IconApple class="size-fit" />
          Continue with Apple
        </Button>
      </Show>
      <Button
        variant="outline"
        size="xl"
        class="bg-surface"
        onClick={props.onEmail}
      >
        Continue with email
      </Button>
    </div>
  );
}
