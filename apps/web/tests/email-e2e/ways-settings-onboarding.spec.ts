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
    // The page's timers are the test's to stop: see below.
    await page.clock.install();
    let failing = true;
    let reads = 0;
    await page.route(/\/email\/email\/links(\?|$)/, async (route) => {
      if (route.request().method() === 'GET') {
        reads += 1;
        if (failing) {
          await route.fulfill({ status: 500, json: {} });
          return;
        }
      }
      await route.fallback();
    });

    await mailbox.open(ONBOARDING);
    const failed = page
      .getByRole('alert')
      .filter({ hasText: "Couldn't load your connected accounts." });
    await expect(failed).toBeVisible({ timeout: 45_000 });

    // The step also reads the accounts again every few seconds on its own,
    // and a failed read is tried again after a wait. With the page's clock
    // stopped neither happens, so a read after the click is the button's.
    await page.clock.pauseAt(new Date(Date.now() + 1_000));
    await expect
      .poll(async () => {
        const before = reads;
        await page.evaluate(() => 0);
        return reads === before;
      })
      .toBe(true);
    const before = reads;
    failing = false;
    await failed.getByRole('button', { name: 'Try again' }).click();
    did('AX-044');
    await expect.poll(() => reads).toBeGreaterThan(before);
    await page.clock.resume();
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
