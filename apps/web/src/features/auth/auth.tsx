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
import { deepEqual } from '@core/util/compareUtils';
import { getNativeMobilePlatform } from '@core/util/platform';
import { getWebOrigin } from '@core/util/webOrigin';
import { useLocation, useNavigate, useSearchParams } from '@solidjs/router';
import { createMemo, onMount } from 'solid-js';
import { match } from 'ts-pattern';
import { AuthProvider, type AuthUser } from './context/auth-context';
import { sessionTokenParam } from './core/email-code';
import {
  AGENT_SETUP_PATH,
  postAuthTarget,
  readRedirectParam,
} from './core/post-auth-target';
import { requiresReauthentication } from './core/reauthentication';
import { createAppAuthContext } from './create-app-auth-context';
import { AuthView } from './views/auth-view';
import { MobileWebSignupView } from './views/mobile-web-signup-view';

/**
 * /login and /signup. Once authenticated, first-time desktop users continue
 * into onboarding in place; everyone else proceeds into the app.
 */
export function Login(props: { signupMode?: boolean }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const requireFreshLogin = requiresReauthentication(
    new URLSearchParams(location.search)
  );
  const navigate = useNavigate();
  const email = typeof params.email === 'string' ? params.email : undefined;
  const desktopSignup = () =>
    props.signupMode === true && !isMobile() && !isNativeMobilePlatform();
  return (
    <AuthProvider
      value={createAppAuthContext({
        requireFreshLogin,
      })}
    >
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
        onAgentSignup={() => navigate('/signup/agent')}
        // Desktop sign-up resolves into onboarding's frame either way.
        pending={desktopSignup() ? () => <OnboardingPending /> : undefined}
        signedIn={(user) => (
          <PostAuthGate
            user={user()}
            redirect={readRedirectParam(params.redirect)}
          />
        )}
      />
    </AuthProvider>
  );
}

/**
 * /signup/agent: Google or an emailed code, without the opening slides. An
 * agent invite links here with `team_invite`, which an existing account still
 * has to accept; a new agent joins the team during setup.
 */
export function AgentSignup() {
  const [params] = useSearchParams();
  const teamInvite = () =>
    typeof params.team_invite === 'string' ? params.team_invite : undefined;
  return (
    <AuthProvider value={createAppAuthContext()}>
      <AuthView
        intent="agent-signup"
        showApple={false}
        compact={virtualKeyboardVisible()}
        token={sessionTokenParam(params.token)}
        signedIn={(user) => (
          <PostLoginRedirect
            target={agentSignupDestination(user(), teamInvite())}
          />
        )}
      />
    </AuthProvider>
  );
}

function agentSignupDestination(user: AuthUser, teamInvite?: string) {
  if (needsAgentSetup(user)) return AGENT_SETUP_PATH;
  if (teamInvite) return `/team-invite?id=${encodeURIComponent(teamInvite)}`;
  return '/';
}

function needsAgentSetup(user: AuthUser) {
  return user.isAgent && !user.tutorialComplete;
}

/**
 * Pages that need an account (team and channel invites, meetings) link to
 * `/login?redirect=`; honor it once signed in, opening an invite before
 * onboarding so the invitee joins first.
 */
function PostAuthGate(props: { user: AuthUser; redirect: unknown }) {
  // Compared by value so a refreshed user object never remounts onboarding.
  const target = createMemo(
    () =>
      postAuthTarget({
        tutorialComplete: props.user.tutorialComplete,
        isAgent: props.user.isAgent,
        onboardsOnThisDevice: !isMobile() && !isNativeMobilePlatform(),
        redirect: props.redirect,
      }),
    undefined,
    { equals: deepEqual }
  );
  return (
    <>
      {match(target())
        .with({ t: 'onboarding' }, ({ next }) => <Onboarding next={next} />)
        .with({ t: 'navigate' }, ({ to }) => <PostLoginRedirect target={to} />)
        .exhaustive()}
    </>
  );
}

/** Login init runs in the per-method handlers; this only navigates. */
function PostLoginRedirect(props: { target: string }) {
  const navigate = useNavigate();
  onMount(() => {
    clearSignupDraft();
    navigate(props.target, { replace: true });
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
