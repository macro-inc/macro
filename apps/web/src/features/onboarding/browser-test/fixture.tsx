import '@fontsource-variable/inter';
import '../../../index.css';
import { createEffect, For, Match, Switch } from 'solid-js';
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
import { OnboardingFlowView } from '../views/onboarding-flow-view';
import { SignupJourneyView } from '../views/signup-journey-view';
import { FIXTURE_KEYS, type FixtureLanding } from './fixture-keys';

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
const fake = createFakeOnboarding(loadWorld(), {
  onChange: saveWorld,
  // The inbox OAuth leaves the page and returns to bare /onboarding.
  roundTrip: async (apply) => {
    apply();
    location.assign(`${location.pathname}?view=flow`);
    await new Promise(() => {});
  },
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

/** Google sign-up creates the account and returns into onboarding. */
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
  landing?.t === 'app' ? `Entered Macro at ${landing.target}` : 'Signed out';

declare global {
  interface Window {
    onboardingFixture: {
      world: () => FakeOnboardingWorld;
      events: typeof events;
      calls: typeof fake.calls;
      notifications: typeof fake.notifications;
    };
  }
}
window.onboardingFixture = {
  world: () => structuredClone(unwrap(fake.world)),
  events,
  calls: fake.calls,
  notifications: fake.notifications,
};

function Fixture() {
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
            onBackFromEmail={() => {}}
            showingEmail={false}
          />
        </Match>
        <Match when={true}>
          <OnboardingFlowView
            next={params.next}
            checkoutReturn={parseCheckoutReturn(params)}
            onNavigate={(target) => land({ t: 'app', target })}
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
