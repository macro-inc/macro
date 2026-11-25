import { expect, test } from '@playwright/test';
import { expectLanded, fakeAuth, fakeCalls, openFixture } from './fixture-page';

const HANDOFF_ID = '01938f2e-7c4a-7b3e-9a51-2f6d8c0e4b17';
const EMAIL = 'returning@example.com';

test.describe("the native apps' first screen", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('Create new account opens the browser sign-up and says what comes next', async ({
    page,
  }) => {
    await openFixture(page, '/?page=welcome');
    await expect(
      page.getByRole('heading', { name: 'Welcome to Macro' })
    ).toBeVisible();
    const create = page.getByRole('button', { name: 'Create new account' });
    await expect(create).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeInViewport();

    await create.click();
    await expect(
      page.getByText('Finish signing up in your browser.')
    ).toBeVisible();
    expect(await fakeCalls(page)).toContain('startAppSignup');
  });

  test('a browser that would not open says so and can be tried again', async ({
    page,
  }) => {
    await openFixture(page, '/?page=welcome', {
      failures: { openBrowser: 'no browser' },
    });
    await page.getByRole('button', { name: 'Create new account' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      "Couldn't open your browser. Please try again."
    );
    await expect(
      page.getByRole('button', { name: 'Create new account' })
    ).toBeEnabled();
  });

  test('Log in opens sign-in', async ({ page }) => {
    await openFixture(page, '/?page=welcome');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(
      page.getByRole('button', { name: 'Continue with Google' })
    ).toBeVisible();
  });

  test('the browser sign-up comes back signed in, redeemed for its sign-up', async ({
    page,
  }) => {
    await openFixture(
      page,
      `/?page=login&token=fake-app-code&app_handoff=${HANDOFF_ID}`,
      {
        accounts: { [EMAIL]: { tutorialComplete: true } },
        sessionTokens: { 'fake-app-code': EMAIL },
      }
    );
    await expectLanded(page, '/');
    const world = await fakeAuth(page);
    expect(world.redeemedAppHandoffs).toEqual([HANDOFF_ID]);
    expect(world.user?.email).toBe(EMAIL);
  });
});
