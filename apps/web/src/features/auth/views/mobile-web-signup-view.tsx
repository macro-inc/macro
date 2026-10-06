import { onMount, Show } from 'solid-js';
import { MobileWebSignupSent } from '../components/mobile-web-signup-sent';
import { MobileWebWelcome } from '../components/mobile-web-welcome';
import { useAuthContext } from '../context/auth-context';
import { createMobileSignup } from '../primitives/mobile-signup';

/**
 * Signing up on a phone is a poor experience, so mobile-web visitors leave
 * their email and get a link to open on desktop instead.
 */
export function MobileWebSignupView(props: {
  onLogin: () => void;
  onBackHome: () => void;
}) {
  const context = useAuthContext();
  const signup = createMobileSignup(context);
  return (
    <Show
      when={signup.submitted()}
      keyed
      fallback={
        <Welcome
          pending={signup.pending()}
          onSignUp={(email) => void signup.submit(email)}
          onLogin={() => {
            context.track('login_from_onboarding');
            props.onLogin();
          }}
        />
      }
    >
      {(email) => <Sent email={email} onBackHome={props.onBackHome} />}
    </Show>
  );
}

function Welcome(props: Parameters<typeof MobileWebWelcome>[0]) {
  const context = useAuthContext();
  onMount(() => context.track('mobile_web_welcome_viewed'));
  return <MobileWebWelcome {...props} />;
}

function Sent(props: { email: string; onBackHome: () => void }) {
  const context = useAuthContext();
  onMount(() => {
    context.track('mobile_web_signup_sent_viewed');
    context.trackMobileSignupLead(props.email);
  });
  return <MobileWebSignupSent onBackHome={props.onBackHome} />;
}
