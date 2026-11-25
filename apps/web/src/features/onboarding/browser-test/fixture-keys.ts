/** sessionStorage keys shared by the fixture page and its Playwright tests. */
export const FIXTURE_KEYS = {
  /** Explicit preview palette retained through simulated external redirects. */
  theme: 'onboarding-fixture:theme',
  /** Partial world merged over the defaults on the first load. */
  seed: 'onboarding-fixture:seed',
  /** The fake backend's current state, persisted across reloads. */
  world: 'onboarding-fixture:world',
  /** Where the flow handed the user off. */
  landed: 'onboarding-fixture:landed',
  /** Analytics recorded across page loads. */
  events: 'onboarding-fixture:events',
  /** Set by `?handoff` (`ios` or `android`): finishing shows the phone-browser last screen. */
  handoff: 'onboarding-fixture:handoff',
  /** Set by `?app`: the native app started this sign-up, so finishing hands back to it. */
  appHandoff: 'onboarding-fixture:app-handoff',
  /** `cancel` makes the fake Stripe return on the cancel leg. */
  checkoutOutcome: 'onboarding-fixture:checkout-outcome',
} as const;

export type FixtureLanding =
  | { t: 'app'; target: string }
  | { t: 'signed-out' }
  | { t: 'sign-in' };

/** The handoff `?app` starts: RFC 7636's example challenge and a fixed id. */
export const FIXTURE_APP_HANDOFF = {
  challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  handoffId: '01938f2e-7c4a-7b3e-9a51-2f6d8c0e4b17',
} as const;
