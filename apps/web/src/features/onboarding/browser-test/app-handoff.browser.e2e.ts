import { expect, type Page, test } from '@playwright/test';
import { FIXTURE_APP_HANDOFF } from './fixture-keys';
import { fakeEvents, heading, openFixture } from './fixture-page';

const appLink = (code: string) =>
  `macro:///login?token=${code}&app_handoff=${FIXTURE_APP_HANDOFF.handoffId}`;

const calls = (page: Page) =>
  page.evaluate(() => window.onboardingFixture.calls());

async function handoffActions(page: Page) {
  return (await fakeEvents(page))
    .filter((e) => e.event === 'onboarding_v4_app_handoff')
    .map((e) => e.data);
}

/** Opening the app leaves the page; keep it here to see what comes next. */
async function stayOnPage(page: Page) {
  await page.evaluate(() =>
    document.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a'))
        event.preventDefault();
    })
  );
}

test.describe('a sign-up the native app started', () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true });

  test('ends by handing a session code back to the app', async ({ page }) => {
    await openFixture(page, '/?view=flow&step=plan&app');
    // The trial's Stripe round trip reloads the page; the handoff survives it.
    await page.getByRole('button', { name: 'Start 30 day trial' }).click();

    await expect(heading(page, 'Your workspace is ready.')).toBeVisible();
    await expect(page.getByText(/You're signed in as/)).toBeVisible();
    const open = page.getByRole('link', { name: 'Open Macro' });
    await expect(open).toBeInViewport();
    await expect(open).toHaveAttribute('href', appLink('fake-app-code-1'));
    expect(await calls(page)).toContain(
      `mintAppSessionCode:${FIXTURE_APP_HANDOFF.handoffId}`
    );

    // An opened code may be spent: the next open gets a new one.
    await stayOnPage(page);
    await open.click();
    await expect(open).toHaveAttribute('href', appLink('fake-app-code-2'));
    expect(await handoffActions(page)).toEqual([
      { action: 'viewed' },
      { action: 'open_app' },
    ]);
  });

  test('ends there instead of on the phone-browser screen', async ({
    page,
  }) => {
    await openFixture(page, '/?view=flow&step=plan&app&handoff');
    await page
      .getByRole('button', { name: 'Continue with Free' })
      .last()
      .click();
    await expect(heading(page, 'Your workspace is ready.')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Download mobile app' })
    ).toHaveCount(0);
  });

  test('a code that could not be minted can be tried again', async ({
    page,
  }) => {
    await openFixture(page, '/?view=app', {
      failures: { appSessionCode: 'unavailable' },
    });
    await expect(page.getByRole('alert')).toHaveText(
      "We couldn't get the app's sign-in ready."
    );
    await expect(page.getByRole('link', { name: 'Open Macro' })).toHaveCount(0);

    await page.evaluate(() =>
      window.onboardingFixture.update({ failures: {} })
    );
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(
      page.getByRole('link', { name: 'Open Macro' })
    ).toHaveAttribute('href', appLink('fake-app-code-1'));
  });

  test('another account starts by signing this one out', async ({ page }) => {
    await openFixture(page, '/?view=app');
    await page.getByRole('button', { name: 'Use a different account' }).click();
    await expect.poll(() => calls(page)).toContain('signOut');
    expect(await handoffActions(page)).toEqual([
      { action: 'viewed' },
      { action: 'switch_account' },
    ]);
  });
});
