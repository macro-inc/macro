import { expect, test } from '@playwright/test';
import {
  expectLanded,
  fakeAuth,
  fakeCalls,
  openFixture,
  signInWithCode,
} from './fixture-page';

test('a returning user signs in with an emailed code', async ({ page }) => {
  await openFixture(page, '/?page=login');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await signInWithCode(page, 'returning@acme.com', '424242');
  await expectLanded(page, '/');
});

test('a wrong code can be corrected without starting over', async ({
  page,
}) => {
  await openFixture(page, '/?page=login');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await signInWithCode(page, 'returning@acme.com', '111111');
  await expect(page.getByRole('alert')).toHaveText('Invalid code.');
  await page.getByLabel('One-time code').fill('424242');
  await expectLanded(page, '/');
});

test('Google sign-in comes back with a session code the page redeems', async ({
  page,
}) => {
  await openFixture(page, '/?page=login', { ssoEmail: 'returning@acme.com' });
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expectLanded(page, '/');
  const world = await fakeAuth(page);
  expect(Object.keys(world.sessionTokens)).toEqual([
    expect.stringMatching(/^google-/),
  ]);
  expect(world.user?.email).toBe('returning@acme.com');
});

test('an expired session code leaves the visitor on sign-in', async ({
  page,
}) => {
  await openFixture(page, '/?page=login&token=expired');
  await expect(page.getByRole('status', { name: 'Notifications' })).toHaveText(
    'Sign-in failed. Please try again.'
  );
  await expect(
    page.getByRole('button', { name: 'Continue with Google' })
  ).toBeVisible();
});

test('a password account signs in with its password', async ({ page }) => {
  await openFixture(page, '/?page=login', {
    passwordAccounts: { 'demo@acme.com': 'hunter2' },
    accounts: { 'demo@acme.com': { tutorialComplete: true } },
  });
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByPlaceholder('you@company.com').fill('demo@acme.com');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByPlaceholder('Password').fill('hunter2');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expectLanded(page, '/');
});

test('a new user who signs in by email continues into onboarding', async ({
  page,
}) => {
  await openFixture(page, '/?page=login');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await signInWithCode(page, 'fresh@acme.com', '424242');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Create your workspace' })
  ).toBeVisible();
});

test('desktop sign-up: slides, Google, then onboarding resumes at the work inbox', async ({
  page,
}) => {
  await openFixture(page, '/?page=signup', { ssoEmail: 'founder@acme.com' });
  await page
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Lilac' }) })
    .click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Connect work email' }).click();

  // Back from Google: signed in, onboarding picks up where sign-up left off.
  await expect(
    page.getByRole('heading', { level: 1, name: /Connect your work/ })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Connect work email' }).click();
  await expect(page.getByText('founder@acme.com')).toBeVisible();
  expect((await fakeAuth(page)).user).toMatchObject({
    email: 'founder@acme.com',
    tutorialComplete: false,
  });
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem('auth-fixture:onboarding') ?? '{}')
          .accent
    )
  ).toBe('#b8a1ed');
});

test('a returning visitor on sign-up can switch to sign in', async ({
  page,
}) => {
  await openFixture(page, '/?page=signup');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Create your workspace' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign in instead' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Welcome to Macro' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await signInWithCode(page, 'returning@acme.com', '424242');
  await expectLanded(page, '/');
});

test('returning from Google sign-up settles into onboarding without flashing', async ({
  page,
}) => {
  // Record, from the first paint of every load, whether the signed-out slide
  // ever shows, and whether the placeholder comes back after a real step.
  await page.addInitScript(() => {
    const w = window as unknown as {
      __frames: { signedOut: boolean; placeholderAfterStep: boolean };
    };
    w.__frames = { signedOut: false, placeholderAfterStep: false };
    let sawStep = false;
    const check = () => {
      const text = document.body?.textContent ?? '';
      if (text.includes('Your work email becomes your Macro sign-in'))
        w.__frames.signedOut = true;
      const placeholder = !!document.querySelector(
        '[aria-label="Loading setup"]'
      );
      if (sawStep && placeholder) w.__frames.placeholderAfterStep = true;
      if (document.querySelector('h1')?.textContent?.includes('Connect your'))
        sawStep = true;
    };
    new MutationObserver(check).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  await openFixture(page, '/?page=signup&latency=500&sso=cookie', {
    ssoEmail: 'founder@acme.com',
  });
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Connect work email' }).click();

  // Back from Google: the session takes 500ms to resolve on the fresh load.
  await expect(
    page.getByRole('heading', { level: 1, name: /Connect your work/ })
  ).toBeVisible();
  // Settled: the step's inbox lookup has landed.
  await expect(
    page.getByRole('button', { name: 'Connect work email' })
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __frames: { signedOut: boolean; placeholderAfterStep: boolean };
          }
        ).__frames
    )
  ).toEqual({ signedOut: false, placeholderAfterStep: false });
});

test('a mobile-web visitor gets a desktop link instead of signing up', async ({
  page,
}) => {
  await openFixture(page, '/?page=mobile-signup');
  await page.getByLabel('Email address').fill('visitor@acme.com');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await expect(
    page.getByRole('heading', { name: 'Macro is better on desktop.' })
  ).toBeVisible();
  expect(await fakeCalls(page)).toContain('lead:visitor@acme.com');
});
