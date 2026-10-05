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
