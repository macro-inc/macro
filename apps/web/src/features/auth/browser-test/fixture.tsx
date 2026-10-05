import '@fontsource-variable/inter';
import '../../../index.css';
import { For, Match, onMount, Show, Switch } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { render } from 'solid-js/web';
import { OnboardingProvider } from '../../onboarding/context/onboarding-context';
import { createFakeOnboarding } from '../../onboarding/tests/fake-onboarding-context';
import { OnboardingFlowView } from '../../onboarding/views/onboarding-flow-view';
import { SignupJourneyView } from '../../onboarding/views/signup-journey-view';
import { AuthProvider, type AuthUser } from '../context/auth-context';
import { sessionTokenParam } from '../core/email-code';
import {
  createFakeAuth,
  defaultFakeAuthWorld,
  type FakeAuthWorld,
} from '../tests/fake-auth-context';
import { AuthView } from '../views/auth-view';
import { MobileWebSignupView } from '../views/mobile-web-signup-view';
import { FIXTURE_KEYS } from './fixture-keys';

/**
 * The real sign-in, sign-up, and onboarding views over fake backends persisted
 * in sessionStorage. SSO is a real round-trip: the page reloads with the
 * `?token=` the auth service would append, and the view redeems it.
 */
const params = Object.fromEntries(new URLSearchParams(location.search));
const page = params.page ?? 'login';
const read = <T,>(key: string): T | undefined => {
  const raw = sessionStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : undefined;
};
const write = (key: string, value: unknown) =>
  sessionStorage.setItem(key, JSON.stringify(value));
const land = (target: string) => {
  write(FIXTURE_KEYS.landed, target);
  location.assign(`${location.pathname}?page=landed`);
};

const auth = createFakeAuth(
  read<FakeAuthWorld>(FIXTURE_KEYS.auth) ?? {
    ...defaultFakeAuthWorld(),
    ...read<Partial<FakeAuthWorld>>(FIXTURE_KEYS.seed),
  },
  {
    onChange: (world) => write(FIXTURE_KEYS.auth, world),
    ssoEmail: sessionStorage.getItem(FIXTURE_KEYS.ssoEmail) ?? undefined,
    // The identity provider returns to the same page with a session code.
    ssoRedirect: async (provider, _intent, email) => {
      const token = `${provider}-${Date.now()}`;
      auth.update((draft) => {
        draft.sessionTokens[token] = email;
      });
      location.assign(`${location.pathname}?page=${page}&token=${token}`);
      await new Promise(() => {});
    },
  }
);
write(FIXTURE_KEYS.auth, structuredClone(unwrap(auth.world)));

/** The onboarding backend, which sees the account auth just signed in. */
function createOnboardingFor(user: AuthUser) {
  const fake = createFakeOnboarding(
    read<Parameters<typeof createFakeOnboarding>[0]>(
      FIXTURE_KEYS.onboarding
    ) ?? {
      viewer: {
        id: user.id,
        email: user.email ?? '',
        tutorialComplete: user.tutorialComplete,
        licensed: false,
      },
      inboxesToConnect: user.email ? [user.email] : [],
    },
    {
      onChange: (world) => write(FIXTURE_KEYS.onboarding, world),
      roundTrip: async (apply) => {
        apply();
        location.reload();
        await new Promise(() => {});
      },
    }
  );
  write(FIXTURE_KEYS.onboarding, structuredClone(unwrap(fake.world)));
  return fake;
}

declare global {
  interface Window {
    authFixture: {
      auth: () => FakeAuthWorld;
      calls: () => string[];
    };
  }
}
window.authFixture = {
  auth: () => structuredClone(unwrap(auth.world)),
  calls: auth.calls,
};

/** Desktop first-run users continue into onboarding; everyone else enters the app. */
function SignedIn(props: { user: AuthUser }) {
  const onboarding = createOnboardingFor(props.user);
  return (
    <Show when={!props.user.tutorialComplete} fallback={<EnterApp />}>
      <OnboardingProvider value={onboarding.context}>
        <OnboardingFlowView
          next={undefined}
          checkoutReturn={undefined}
          onNavigate={land}
          onRedirect={(url) => location.assign(url)}
          onSignedOut={() => land('/login')}
        />
      </OnboardingProvider>
    </Show>
  );
}

function EnterApp() {
  onMount(() => land('/'));
  return null;
}

/** The signed-out slides only read presentation state; nothing to persist. */
function SignupJourney(props: Parameters<typeof SignupJourneyView>[0]) {
  return (
    <OnboardingProvider value={createFakeOnboarding({ viewer: null }).context}>
      <SignupJourneyView {...props} />
    </OnboardingProvider>
  );
}

function Fixture() {
  return (
    <AuthProvider value={auth.context}>
      <Switch>
        <Match when={page === 'landed'}>
          <main data-testid="landed" class="p-8 text-ink">
            Entered Macro at {read<string>(FIXTURE_KEYS.landed)}
          </main>
        </Match>
        <Match when={page === 'mobile-signup'}>
          <MobileWebSignupView
            onLogin={() => location.assign(`${location.pathname}?page=login`)}
            onBackHome={() => land('/home-page')}
          />
        </Match>
        <Match when={true}>
          <AuthView
            intent={page === 'signup' ? 'signup' : 'login'}
            showApple={params.apple !== undefined}
            compact={false}
            initialEmail={params.email}
            token={sessionTokenParam(params.token)}
            signupJourney={
              page === 'signup'
                ? (slots) => <SignupJourney {...slots} />
                : undefined
            }
            signedIn={(user) => <SignedIn user={user} />}
          />
        </Match>
      </Switch>
      <div
        role="status"
        aria-label="Notifications"
        class="fixed top-4 left-1/2 z-[2000] -translate-x-1/2 text-sm text-ink"
      >
        <For each={auth.notifications()}>
          {(message) => <p class="rounded bg-input px-3 py-2">{message}</p>}
        </For>
      </div>
    </AuthProvider>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
