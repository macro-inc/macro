/** sessionStorage keys shared by the fixture page and its Playwright tests. */
export const FIXTURE_KEYS = {
  /** Partial auth world merged over the defaults on the first load. */
  seed: 'auth-fixture:seed',
  auth: 'auth-fixture:auth',
  /** The onboarding backend a new user continues into. */
  onboarding: 'auth-fixture:onboarding',
  /** Who Google/Apple sign in as. */
  ssoEmail: 'auth-fixture:sso-email',
  landed: 'auth-fixture:landed',
} as const;
