import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal } from 'solid-js';
import { LoginCard } from '../components/login-card';
import {
  type AppSignupState,
  WelcomePicker,
} from '../components/welcome-picker';
import { useAuthContext } from '../context/auth-context';

/**
 * The native apps' first screen. A new account is made in the system
 * browser, through the web sign-up and onboarding, which hand the session
 * back to the app; an existing one signs in here.
 */
export function NativeWelcomeView(props: {
  /** The header yields to the on-screen keyboard on phones. */
  compact: boolean;
  onLogIn: () => void;
}) {
  const context = useAuthContext();
  const [signup, setSignup] = createSignal<AppSignupState>('idle');
  const createAccount = async () => {
    setSignup('opening');
    context.track('sign_up_click', { method: 'browser' });
    setSignup(await context.startAppSignup());
  };
  return (
    <LoginCard compact={props.compact}>
      <WelcomePicker
        signup={signup()}
        onCreateAccount={() => fireAndForget(createAccount(), 'auth')}
        onLogIn={props.onLogIn}
      />
    </LoginCard>
  );
}
