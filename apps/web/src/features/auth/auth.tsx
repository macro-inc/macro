import { APP_HANDOFF_PARAMS } from '@app/features/onboarding/core/app-handoff';
import {
  clearSignupDraft,
  forgetAppHandoff,
  Onboarding,
  OnboardingAppHandoff,
  OnboardingPending,
  OnboardingSignup,
  pendingAppHandoff,
  rememberAppHandoff,
} from '@app/features/onboarding/onboarding';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { endSessionInPlace } from '@core/auth/logout';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableMicrosoftSignup } from '@core/constant/featureFlags';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { deepEqual } from '@core/util/compareUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import { getNativeMobilePlatform } from '@core/util/platform';
import {
  type SearchParams,
  useNavigate,
  useSearchParams,
} from '@solidjs/router';
import { ResultAsync } from 'neverthrow';
import { createMemo, createSignal, onMount, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { AuthProvider, type AuthUser } from './context/auth-context';
import { sessionTokenParam } from './core/email-code';
import {
  AGENT_SETUP_PATH,
  postAuthTarget,
  readRedirectParam,
} from './core/post-auth-target';
import { ssoFallbackNotice } from './core/sso-fallback';
import { createAppAuthContext } from './create-app-auth-context';
import { AuthView } from './views/auth-view';
import { NativeWelcomeView } from './views/native-welcome-view';

/**
 * /login and /signup. Once authenticated, first-time web users (desktop and
 * phone browsers) continue into onboarding in place; the native apps proceed
 * into the app.
 */
export function Login(props: { signupMode?: boolean }) {
  const [params, setParams] = useSearchParams();
  const webSignup = () =>
    props.signupMode === true && !isNativeMobilePlatform();
  // A sign-up the native app opened starts signed out: the browser hands the
  // app whichever account signs in here, and an account this browser already
  // held was not chosen for the app that opened the link (which may not even
  // be Macro). The link's parameters go, so a reload mid-sign-up keeps the
  // new session.
  const startingAppSignup = webSignup() && rememberAppHandoff(params);
  const [signedOutForApp, setSignedOutForApp] = createSignal(
    !startingAppSignup
  );
  if (startingAppSignup) {
    setParams(
      {
        [APP_HANDOFF_PARAMS.challenge]: undefined,
        [APP_HANDOFF_PARAMS.handoffId]: undefined,
      },
      { replace: true }
    );
    fireAndForget(
      startAppSignupSignedOut(() => setSignedOutForApp(true)),
      'auth'
    );
  }
  return (
    <Show when={signedOutForApp()} fallback={<OnboardingPending />}>
      <LoginView
        params={params}
        signupMode={props.signupMode}
        webSignup={webSignup()}
      />
    </Show>
  );
}

/**
 * Signs out whatever session the browser held. If that fails, the sign-up
 * goes on without handing its session to the app.
 */
async function startAppSignupSignedOut(onDone: () => void) {
  const ended = await ResultAsync.fromPromise(endSessionInPlace(), () => false);
  if (!ended.unwrapOr(false)) forgetAppHandoff();
  onDone();
}

function LoginView(props: {
  params: Partial<SearchParams>;
  signupMode: boolean | undefined;
  webSignup: boolean;
}) {
  const params = props.params;
  const navigate = useNavigate();
  const email = typeof params.email === 'string' ? params.email : undefined;
  const microsoftSignup = useFeatureFlag(enableMicrosoftSignup);
  const webSignup = () => props.webSignup;
  return (
    <AuthProvider value={createAppAuthContext()}>
      <AuthView
        intent={props.signupMode ? 'signup' : 'login'}
        showApple={getNativeMobilePlatform() === 'ios'}
        showMicrosoft={microsoftSignup().enabled}
        compact={virtualKeyboardVisible()}
        initialEmail={email}
        // Dev persona links (`?email=`) sign straight in against a local backend.
        autoStart={import.meta.env.DEV && email !== undefined}
        token={sessionTokenParam(params.token)}
        appHandoffId={
          isNativeMobilePlatform()
            ? sessionTokenParam(params[APP_HANDOFF_PARAMS.handoffId])
            : undefined
        }
        ssoFallbackNotice={ssoFallbackNotice(
          typeof params.sso_error === 'string' ? params.sso_error : undefined
        )}
        onVerified={() => {
          const referral = new URLSearchParams(window.location.search).get(
            'referral'
          );
          if (referral) window.location.href = `/app?referral=${referral}`;
        }}
        signupJourney={
          webSignup() ? (slots) => <OnboardingSignup {...slots} /> : undefined
        }
        onSignIn={() => navigate('/login')}
        onAgentSignup={() => navigate('/signup/agent')}
        // Web sign-up resolves into onboarding's frame either way.
        pending={webSignup() ? () => <OnboardingPending /> : undefined}
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
 * The native apps' signed-out entry (`/welcome`): Create new account opens
 * the web sign-up in the system browser, which hands the session back to the
 * app; Log in opens /login.
 */
export function NativeWelcome() {
  const navigate = useNavigate();
  const analytics = useAnalytics();
  onMount(() => analytics.pageView('mobile_auth_welcome'));
  return (
    <AuthProvider value={createAppAuthContext()}>
      <NativeWelcomeView
        compact={virtualKeyboardVisible()}
        onLogIn={() => navigate('/login')}
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
 * onboarding so the invitee joins first. A sign-up the native app started in
 * this tab ends by handing the session back to the app instead of entering
 * the web app, whether the account is new (once onboarding completes) or
 * already existed.
 */
function PostAuthGate(props: { user: AuthUser; redirect: unknown }) {
  const appHandoff = isNativeMobilePlatform() ? undefined : pendingAppHandoff();
  // Compared by value so a refreshed user object never remounts onboarding.
  const target = createMemo(
    () =>
      postAuthTarget({
        tutorialComplete: props.user.tutorialComplete,
        isAgent: props.user.isAgent,
        onboardsOnThisDevice: !isNativeMobilePlatform(),
        redirect: props.redirect,
      }),
    undefined,
    { equals: deepEqual }
  );
  return (
    <>
      {match(target())
        .with({ t: 'onboarding' }, ({ next }) => <Onboarding next={next} />)
        .with({ t: 'navigate' }, ({ to }) =>
          appHandoff ? (
            <OnboardingAppHandoff handoff={appHandoff} />
          ) : (
            <PostLoginRedirect target={to} />
          )
        )
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
