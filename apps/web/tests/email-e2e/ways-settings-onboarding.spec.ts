// The email step of onboarding beyond connecting the work email: moving on
// from it, connecting a personal email on the step after it, trying again
// when the connected accounts could not be loaded, and skipping the step.

import { loadAppSteadily } from './harness/drafts';
import { anInbox, PROVIDERS } from './harness/providers';
import { becomeFirstRun, removeInbox } from './harness/ways-settings';
import { connectedInboxes, expect, test } from './harness/ways-settings-more';
import { confirmed, did } from './ledger/record';

const HOME = 'home@example.com';
const ONBOARDING = '/app/onboarding?step=work';

test.beforeEach(({ page }) => loadAppSteadily(page));

for (const provider of PROVIDERS) {
  test.describe(`onboarding with ${anInbox(provider)} connected`, () => {
    test.use({ provider });

    // When this fails, Continue does not move on from the email steps, or
    // "Connect personal email" does not connect the account picked and come
    // back to the step showing it.
    test('Continue moves on, and the personal email connected on the next step is shown there', async ({
      page,
      mailbox,
      auth,
    }) => {
      await auth.googleAccount({ email: HOME });
      becomeFirstRun(mailbox);
      await mailbox.open(ONBOARDING);

      await expect(page.getByText('Work email connected')).toBeVisible();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      did('AX-213');
      await expect(
        page.getByRole('heading', { name: /Add your personal/ })
      ).toBeVisible();

      await page
        .getByRole('button', { name: 'Connect personal email' })
        .click();
      did('AX-212');
      await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
      await page.getByRole('button', { name: /home@example\.com/ }).click();
      await expect(page).toHaveURL(/\/app\/onboarding/);
      await expect(
        page.getByRole('status').filter({ hasText: HOME })
      ).toBeVisible();
      await expect
        .poll(() => connectedInboxes(mailbox))
        .toEqual([mailbox.inbox.email, HOME].sort());
      confirmed('F-010');
      expect(auth.starts).toHaveLength(1);

      await page.getByRole('button', { name: 'Choose integrations' }).click();
      did('AX-213');
      await expect(
        page.getByRole('heading', { name: /Connect your tools/ })
      ).toBeVisible();
    });
  });
}

test.describe('onboarding without a connected inbox', () => {
  // When this fails, "Try again" under "Couldn't load your connected
  // accounts." does not load them again, or "Skip for now" does not move on
  // to the tools without connecting anything.
  test('Try again loads the accounts after a failed load, and Skip for now moves on to the tools', async ({
    page,
    mailbox,
    auth,
  }) => {
    await removeInbox(mailbox);
    becomeFirstRun(mailbox);
    let failing = true;
    await page.route(/\/email\/email\/links(\?|$)/, async (route) => {
      if (failing && route.request().method() === 'GET') {
        await route.fulfill({ status: 500, json: {} });
        return;
      }
      await route.fallback();
    });

    await mailbox.open(ONBOARDING);
    const failed = page
      .getByRole('alert')
      .filter({ hasText: "Couldn't load your connected accounts." });
    await expect(failed).toBeVisible({ timeout: 45_000 });

    // The load starts working at the click, not before it. The step also
    // reads the accounts again every few seconds on its own, so a Try again
    // that did nothing would still pass here once it was clicked.
    await page.exposeFunction('emailE2eLoadsAgain', () => {
      failing = false;
    });
    await page.evaluate(() =>
      document.addEventListener(
        'click',
        (event) => {
          const button = (event.target as Element).closest('button');
          if (button?.textContent?.trim() !== 'Try again') return;
          (
            window as unknown as { emailE2eLoadsAgain(): void }
          ).emailE2eLoadsAgain();
        },
        { capture: true }
      )
    );
    await failed.getByRole('button', { name: 'Try again' }).click();
    did('AX-044');
    await expect(failed).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Connect work email' })
    ).toBeEnabled();

    await page.getByRole('button', { name: 'Skip for now' }).click();
    did('AX-214');
    await expect(
      page.getByRole('heading', { name: /Connect your tools/ })
    ).toBeVisible();
    expect(auth.starts).toHaveLength(0);
    expect(await connectedInboxes(mailbox)).toEqual([]);
  });
});
