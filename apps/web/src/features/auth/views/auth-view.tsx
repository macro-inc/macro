import { Stepper } from '@ui/components/Stepper';
import {
  type Accessor,
  type JSX,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { EmailForm } from '../components/email-form';
import { LoginCard } from '../components/login-card';
import { LoginPicker } from '../components/login-picker';
import { VerifyForm } from '../components/verify-form';
import {
  type AuthIntent,
  type AuthUser,
  useAuthContext,
} from '../context/auth-context';
import { createEmailLogin, type EmailLogin } from '../primitives/email-login';
import {
  createSessionIdentity,
  redeemSessionToken,
} from '../primitives/session';

/** What desktop sign-up hands onboarding's opening slides. */
export type SignupJourneySlots = {
  onGoogle: () => Promise<void>;
  onBackFromEmail: () => void;
  onSignIn: () => void;
  emailForm: JSX.Element;
  showingEmail: boolean;
};

/** Sign-in and sign-up: SSO or an emailed code, then whatever comes next. */
export function AuthView(props: {
  intent: AuthIntent;
  showApple: boolean;
  /** The header yields to the on-screen keyboard on phones. */
  compact: boolean;
  initialEmail?: string;
  autoStart?: boolean;
  /** The session code an SSO return put on the URL. */
  token?: string;
  onVerified?: () => void;
  /** Desktop sign-up: onboarding's slides host Google and the email form. */
  signupJourney?: (slots: SignupJourneySlots) => JSX.Element;
  /** Switches a returning visitor from sign-up to sign-in. */
  onSignIn?: () => void;
  /**
   * Shown while the session is still resolving on a cold load, instead of the
   * signed-out screens a returning visitor would otherwise see flash by.
   */
  pending?: () => JSX.Element;
  /** What a signed-in visitor sees instead. */
  signedIn: (user: Accessor<AuthUser>) => JSX.Element;
}) {
  const context = useAuthContext();
  const login = createEmailLogin(context, {
    intent: props.intent,
    initialEmail: props.initialEmail,
    autoStart: props.autoStart,
    onVerified: props.onVerified,
  });
  createSessionIdentity(context);
  redeemSessionToken(context, () => props.token);
  onMount(() => context.pageView(props.intent));

  const user = () => {
    const session = context.session();
    return session.t === 'signed-in' ? session.user : undefined;
  };

  const signedOut = () => (
    <Switch>
      <Match when={props.signupJourney}>
        {(journey) =>
          journey()({
            onGoogle: () => context.startSso('google', 'signup'),
            onBackFromEmail: login.back,
            onSignIn: () => props.onSignIn?.(),
            showingEmail: login.step() !== 'choose',
            emailForm: (
              <Show when={login.step() !== 'choose'}>
                <Stepper
                  step={login.step() === 'verify' ? 1 : 0}
                  transition={Stepper.transitions.scale}
                >
                  <Stepper.Step>
                    <EmailStep login={login} />
                  </Stepper.Step>
                  <Stepper.Step>
                    <VerifyStep login={login} />
                  </Stepper.Step>
                </Stepper>
              </Show>
            ),
          })
        }
      </Match>
      <Match when={true}>
        <LoginCard compact={props.compact}>
          <Stepper
            step={STEP_INDEX[login.step()]}
            transition={Stepper.transitions.scale}
          >
            <Stepper.Step>
              <LoginPicker
                showApple={props.showApple}
                onGoogle={() => void context.startSso('google', props.intent)}
                onApple={() => void context.startSso('apple', props.intent)}
                onEmail={login.chooseEmail}
              />
            </Stepper.Step>
            <Stepper.Step>
              <EmailStep login={login} />
            </Stepper.Step>
            <Stepper.Step>
              <VerifyStep login={login} />
            </Stepper.Step>
          </Stepper>
        </LoginCard>
      </Match>
    </Switch>
  );

  return (
    <Show when={context.session().t !== 'loading'} fallback={props.pending?.()}>
      <Show when={user()} fallback={signedOut()}>
        {(signedIn) => (
          // Refreshes update the existing workspace; only changing accounts
          // should remount it and restart its pending work.
          <Show when={signedIn().id} keyed>
            {(_id) => props.signedIn(signedIn)}
          </Show>
        )}
      </Show>
    </Show>
  );
}

const STEP_INDEX = { choose: 0, email: 1, verify: 2 } as const;

function EmailStep(props: { login: EmailLogin }) {
  return (
    <EmailForm
      email={props.login.email()}
      password={props.login.password()}
      passwordRequired={props.login.passwordRequired()}
      sending={props.login.sending()}
      error={props.login.sendError()}
      onEmailInput={props.login.setEmail}
      onPasswordInput={props.login.setPassword}
      onSubmit={props.login.submitEmail}
      onBack={props.login.back}
    />
  );
}

function VerifyStep(props: { login: EmailLogin }) {
  return (
    <VerifyForm
      email={props.login.email()}
      code={props.login.code()}
      verifying={props.login.verifying()}
      canVerify={props.login.canVerify()}
      resendIn={props.login.resendIn()}
      resending={props.login.sending()}
      error={props.login.verifyError() ?? props.login.sendError()}
      onCodeInput={props.login.setCode}
      onVerify={props.login.verify}
      onResend={() => void props.login.resend()}
      onBack={props.login.back}
    />
  );
}
