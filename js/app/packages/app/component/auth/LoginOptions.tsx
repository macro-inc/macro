import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { GOOGLE_GMAIL_IDP } from '@core/auth/email';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getNativeMobilePlatform } from '@core/util/platform';
import IconApple from '@icon/macro-apple.svg';
import IconGoogle from '@icon/macro-google.svg';
import IconMail from '@icon/macro-mail.svg';
import { type JSX, Show } from 'solid-js';
import { Stage } from './Shared';
import { useSsoLogin } from './useSsoLogin';

function LoginOption(props: {
  icon: JSX.Element;
  label: string;
  onClick: () => void;
}) {
  return (
    <div
      onClick={(_e) => {
        if (isTouchDevice()) return;
        props.onClick();
      }}
      // Using onPointerDown so that on touch device able to interact with button before closing virtual keyboard
      onPointerDown={(e) => {
        if (!isTouchDevice()) return;
        e.stopPropagation();
        e.preventDefault();
        props.onClick();
      }}
      class="grid items-center justify-center p-4 border-b border-edge-muted [transition:color_var(--transition)] hover:bg-hover/60 hover:text-accent hover:transition-none"
    >
      <div class="flex gap-2.5 items-center justify-center">
        {props.icon}
        <div class="whitespace-nowrap">{props.label}</div>
      </div>
    </div>
  );
}

export function LoginOptions(props: {
  setStage: (next: Stage) => void;
  signupMode?: boolean;
}) {
  const startSsoLogin = useSsoLogin({ signupMode: props.signupMode });

  return (
    <div class="grid select-none border-t border-edge-muted">
      <Show when={getNativeMobilePlatform() === 'ios'}>
        <LoginOption
          icon={<IconApple />}
          label="Continue with Apple"
          onClick={() => startSsoLogin('Apple')}
        />
      </Show>

      <LoginOption
        icon={<IconGoogle />}
        label={
          props.signupMode ? 'Sign up with Google' : 'Continue with Google'
        }
        onClick={() => startSsoLogin(GOOGLE_GMAIL_IDP)}
      />

      <Show when={!props.signupMode && !isNativeMobilePlatform()}>
        <LoginOption
          icon={<IconApple />}
          label="Continue with Apple"
          onClick={() => startSsoLogin('Apple')}
        />
      </Show>

      <Show when={!props.signupMode}>
        <LoginOption
          icon={<IconMail />}
          label="Continue with Email"
          onClick={() => props.setStage(Stage.Email)}
        />
      </Show>

      <Show when={props.signupMode}>
        <div class="p-4 text-center text-xs text-ink/50">
          <a
            class="underline hover:text-ink/70"
            href={`${ROUTER_BASE_CONCAT}login`}
          >
            Existing user? Log in
          </a>
        </div>
      </Show>

      <div class="p-4 text-center text-xs text-ink/50">
        By signing up, you agree to our
        <br />
        <a class="underline hover:text-ink/70" href="/terms">
          terms
        </a>{' '}
        and{' '}
        <a class="underline hover:text-ink/70" href="/privacy">
          privacy policy
        </a>
        .
      </div>
    </div>
  );
}
