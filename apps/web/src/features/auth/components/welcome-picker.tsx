import { Match, Switch } from 'solid-js';
import { AuthButton } from './form-fields';

/** Where the browser sign-up stands, as the first screen shows it. */
export type AppSignupState = 'idle' | 'opening' | 'opened' | 'failed';

/** The native apps' first screen: a new account, or an existing one. */
export function WelcomePicker(props: {
  signup: AppSignupState;
  onCreateAccount: () => void;
  onLogIn: () => void;
}) {
  return (
    <div class="flex flex-col gap-3">
      <AuthButton
        disabled={props.signup === 'opening'}
        onClick={props.onCreateAccount}
      >
        Create new account
      </AuthButton>
      <AuthButton variant="secondary" onClick={props.onLogIn}>
        Log in
      </AuthButton>
      <Switch>
        <Match when={props.signup === 'opened'}>
          <p class="pt-2 text-center text-sm leading-6 text-ink-muted [text-wrap:balance]">
            Finish signing up in your browser. It brings you back here signed
            in.
          </p>
        </Match>
        <Match when={props.signup === 'failed'}>
          <p
            role="alert"
            class="pt-2 text-center text-sm leading-6 text-ink-muted [text-wrap:balance]"
          >
            Couldn't open your browser. Please try again.
          </p>
        </Match>
      </Switch>
    </div>
  );
}
