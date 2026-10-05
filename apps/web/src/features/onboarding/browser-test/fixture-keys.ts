/** sessionStorage keys shared by the fixture page and its Playwright tests. */
export const FIXTURE_KEYS = {
  /** Partial world merged over the defaults on the first load. */
  seed: 'onboarding-fixture:seed',
  /** The fake backend's current state, persisted across reloads. */
  world: 'onboarding-fixture:world',
  /** Where the flow handed the user off. */
  landed: 'onboarding-fixture:landed',
  /** Analytics recorded across page loads. */
  events: 'onboarding-fixture:events',
  /** `cancel` makes the fake Stripe return on the cancel leg. */
  checkoutOutcome: 'onboarding-fixture:checkout-outcome',
} as const;

export type FixtureLanding = { t: 'app'; target: string } | { t: 'signed-out' };
