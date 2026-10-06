import {
  clearSignupDraft,
  Onboarding,
  OnboardingPending,
  OnboardingSignup,
} from '@app/features/onboarding/onboarding';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { getNativeMobilePlatform } from '@core/util/platform';
import { getWebOrigin } from '@core/util/webOrigin';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { onMount, Show } from 'solid-js';
import { AuthProvider, type AuthUser } from './context/auth-context';
import { sessionTokenParam } from './core/email-code';
import { createAppAuthContext } from './create-app-auth-context';
import { AuthView } from './views/auth-view';
import { MobileWebSignupView } from './views/mobile-web-signup-view';

/**
 * /login and /signup. Once authenticated, first-time desktop users continue
 * into onboarding in place; everyone else proceeds into the app.
 */
export function Login(props: { signupMode?: boolean }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const email = typeof params.email === 'string' ? params.email : undefined;
  const desktopSignup = () =>
    props.signupMode === true && !isMobile() && !isNativeMobilePlatform();
  return (
    <AuthProvider value={createAppAuthContext()}>
      <AuthView
        intent={props.signupMode ? 'signup' : 'login'}
        showApple={getNativeMobilePlatform() === 'ios'}
        compact={virtualKeyboardVisible()}
        initialEmail={email}
        // Dev persona links (`?email=`) sign straight in against a local backend.
        autoStart={import.meta.env.DEV && email !== undefined}
        token={sessionTokenParam(params.token)}
        onVerified={() => {
          const referral = new URLSearchParams(window.location.search).get(
            'referral'
          );
          if (referral) window.location.href = `/app?referral=${referral}`;
        }}
        signupJourney={
          desktopSignup()
            ? (slots) => <OnboardingSignup {...slots} />
            : undefined
        }
        onSignIn={() => navigate('/login')}
        // Desktop sign-up resolves into onboarding's frame either way.
        pending={desktopSignup() ? () => <OnboardingPending /> : undefined}
        signedIn={(user) => <PostAuthGate user={user()} />}
      />
    </AuthProvider>
  );
}

function PostAuthGate(props: { user: AuthUser }) {
  const needsOnboarding = () =>
    !isMobile() && !isNativeMobilePlatform() && !props.user.tutorialComplete;
  return (
    <Show when={needsOnboarding()} fallback={<PostLoginRedirect />}>
      <Onboarding />
    </Show>
  );
}

/** Login init runs in the per-method handlers; this only navigates. */
function PostLoginRedirect() {
  const navigate = useNavigate();
  onMount(() => {
    clearSignupDraft();
    navigate('/', { replace: true });
  });
  return <LoadingBlock />;
}

/** Mobile-web visitors get a desktop link instead of signing up on a phone. */
export function MobileWebSignup() {
  const navigate = useNavigate();
  return (
    <AuthProvider value={createAppAuthContext()}>
      <MobileWebSignupView
        onLogin={() => navigate('/login')}
        onBackHome={() => {
          window.location.href = getWebOrigin();
        }}
      />
    </AuthProvider>
  );
}
