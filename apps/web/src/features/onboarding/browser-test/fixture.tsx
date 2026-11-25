import '@fontsource-variable/inter';
import '../../../index.css';
import { createEffect, createSignal, For, Match, Switch } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { render } from 'solid-js/web';
import { OnboardingProvider } from '../context/onboarding-context';
import { parseCheckoutReturn } from '../core/checkout';
import {
  createFakeOnboarding,
  defaultFakeWorld,
  type FakeOnboardingWorld,
} from '../tests/fake-onboarding-context';
import { renderInviteOfferStub } from '../tests/invite-offer-stub';
import { AppHandoffView } from '../views/app-handoff-view';
import { DesktopHandoffView } from '../views/desktop-handoff-view';
import { OnboardingFlowView } from '../views/onboarding-flow-view';
import { SignupJourneyView } from '../views/signup-journey-view';
import {
  FIXTURE_APP_HANDOFF,
  FIXTURE_KEYS,
  type FixtureLanding,
} from './fixture-keys';

/**
 * The real onboarding views over a fake backend persisted in sessionStorage,
 * so OAuth and Stripe round-trips are real page loads. Tests seed the world
 * through `FIXTURE_KEYS.seed` before the first load.
 */
function loadWorld(): FakeOnboardingWorld {
  const saved = sessionStorage.getItem(FIXTURE_KEYS.world);
  if (saved) return JSON.parse(saved);
  const seed = sessionStorage.getItem(FIXTURE_KEYS.seed);
  return { ...defaultFakeWorld(), ...(seed ? JSON.parse(seed) : {}) };
}
const saveWorld = (world: FakeOnboardingWorld) =>
  sessionStorage.setItem(FIXTURE_KEYS.world, JSON.stringify(world));
const land = (landing: FixtureLanding) => {
  sessionStorage.setItem(FIXTURE_KEYS.landed, JSON.stringify(landing));
  location.assign(`${location.pathname}?view=landed`);
};

const params = Object.fromEntries(new URLSearchParams(location.search));
if (params.theme === 'cream' || params.theme === 'dark') {
  sessionStorage.setItem(FIXTURE_KEYS.theme, params.theme);
}
const previewTheme = sessionStorage.getItem(FIXTURE_KEYS.theme);
// Preview the same local palette that the app's theme selection supplies.
const lightScheme = window.matchMedia('(prefers-color-scheme: light)');
const applyPreviewTheme = () => {
  document.documentElement.dataset.themeLight = String(
    previewTheme === 'cream' || (previewTheme !== 'dark' && lightScheme.matches)
  );
};
applyPreviewTheme();
lightScheme.addEventListener('change', applyPreviewTheme);
const fake = createFakeOnboarding(loadWorld(), {
  onChange: saveWorld,
  // The inbox OAuth leaves the page and returns to bare /onboarding.
  roundTrip: async (apply) => {
    apply();
    location.assign(`${location.pathname}?view=flow`);
    await new Promise(() => {});
  },
  // `?latency=ms`: the viewer and sources load like a cold page instead of instantly.
  latencyMs: Number(params.latency ?? 0),
  viewerLatencyMs: Number(params.latency ?? 0),
  checkoutUrl: (tier) =>
    sessionStorage.getItem(FIXTURE_KEYS.checkoutOutcome) === 'cancel'
      ? `${location.pathname}?view=flow&subscriptionCancel=true`
      : `${location.pathname}?view=flow&subscriptionSuccess=true&type=${tier}`,
});
saveWorld(structuredClone(unwrap(fake.world)));

// Events outlive the page: the flow's last act is often a navigation.
const earlierEvents = JSON.parse(
  sessionStorage.getItem(FIXTURE_KEYS.events) ?? '[]'
) as ReturnType<typeof fake.events>;
const events = () => [...earlierEvents, ...fake.events()];
createEffect(() =>
  sessionStorage.setItem(FIXTURE_KEYS.events, JSON.stringify(events()))
);

/** Google or Microsoft sign-up creates the account and returns into onboarding. */
const signUpWithGoogle = async () => {
  fake.update((draft) => {
    draft.viewer = defaultFakeWorld().viewer;
  });
  location.assign(`${location.pathname}?view=flow`);
  await new Promise(() => {});
};

const landed = (): FixtureLanding | undefined => {
  const raw = sessionStorage.getItem(FIXTURE_KEYS.landed);
  return raw ? JSON.parse(raw) : undefined;
};

const landingText = (landing: FixtureLanding | undefined) =>
  landing?.t === 'app'
    ? `Entered Macro at ${landing.target}`
    : landing?.t === 'sign-in'
      ? 'Sign in'
      : 'Signed out';

declare global {
  interface Window {
    onboardingFixture: {
      world: () => FakeOnboardingWorld;
      events: typeof events;
      calls: typeof fake.calls;
      notifications: typeof fake.notifications;
      /** Changes the fake backend in place, e.g. to stream suggestions in. */
      update: (patch: Partial<FakeOnboardingWorld>) => void;
    };
  }
}
window.onboardingFixture = {
  world: () => structuredClone(unwrap(fake.world)),
  events,
  calls: fake.calls,
  notifications: fake.notifications,
  update: (patch) =>
    fake.update((draft) => {
      Object.assign(draft, patch);
    }),
};

// `?handoff`: a phone browser's last screen, "Macro is better on desktop";
// `?handoff=android` shows the Google Play button. Kept in sessionStorage so
// it survives the simulated Stripe round-trip.
if (params.handoff !== undefined) {
  sessionStorage.setItem(
    FIXTURE_KEYS.handoff,
    params.handoff === 'android' ? 'android' : 'ios'
  );
}
const handoffPlatform = sessionStorage.getItem(FIXTURE_KEYS.handoff);
const handoff = handoffPlatform !== null;

// `?app`: the native app started this sign-up, so finishing ends on its
// "Open Macro" screen. `?view=app` opens that screen directly.
if (params.app !== undefined || params.view === 'app') {
  sessionStorage.setItem(FIXTURE_KEYS.appHandoff, 'true');
}
const appHandoff =
  sessionStorage.getItem(FIXTURE_KEYS.appHandoff) === null
    ? undefined
    : { ...FIXTURE_APP_HANDOFF, savedAt: Date.now(), signedOut: true };

function Fixture() {
  const [handoffTarget, setHandoffTarget] = createSignal<string>();
  const [appFinished, setAppFinished] = createSignal(params.view === 'app');
  const onFinished = (target: string) => {
    if (appHandoff) setAppFinished(true);
    else if (handoff) setHandoffTarget(target);
    else land({ t: 'app', target });
  };
  return (
    <OnboardingProvider value={fake.context}>
      <Switch>
        <Match when={params.view === 'landed'}>
          <main data-testid="landed" class="p-8 text-ink">
            {landingText(landed())}
          </main>
        </Match>
        <Match when={params.view === 'signup'}>
          <SignupJourneyView
            onGoogle={signUpWithGoogle}
            onMicrosoft={signUpWithGoogle}
            onBackFromEmail={() => {}}
            onSignIn={() => land({ t: 'sign-in' })}
            onAgentSignup={() => {}}
            showingEmail={false}
          />
        </Match>
        <Match when={appFinished() && appHandoff}>
          {(handoff) => <AppHandoffView handoff={handoff()} />}
        </Match>
        <Match when={handoffTarget()}>
          {(target) => (
            <DesktopHandoffView
              storeUrl={
                handoffPlatform === 'android'
                  ? 'https://play.google.com/store/apps/details?id=com.macro.workspace.mobile'
                  : 'https://apps.apple.com/us/app/macro-app/id6743133649'
              }
              platform={handoffPlatform === 'android' ? 'android' : 'ios'}
              onContinue={() => land({ t: 'app', target: target() })}
            />
          )}
        </Match>
        <Match when={true}>
          <OnboardingFlowView
            next={params.next}
            step={params.step}
            checkoutReturn={parseCheckoutReturn(params)}
            onNavigate={(target) => land({ t: 'app', target })}
            onFinished={onFinished}
            onRedirect={(url) => location.assign(url)}
            onSignedOut={() => land({ t: 'signed-out' })}
            renderInviteOffer={renderInviteOfferStub}
          />
        </Match>
      </Switch>
      <div
        role="status"
        aria-label="Notifications"
        class="fixed top-4 left-1/2 z-[2000] -translate-x-1/2 text-sm text-ink"
      >
        <For each={fake.notifications()}>
          {(message) => <p class="rounded bg-input px-3 py-2">{message}</p>}
        </For>
      </div>
      <details class="fixed bottom-1 right-1 z-[2000] max-h-40 max-w-80 overflow-auto bg-surface text-xs text-ink">
        <summary>Fake backend (no network)</summary>
        <For each={events()}>{(item) => <p>{item.event}</p>}</For>
      </details>
    </OnboardingProvider>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
