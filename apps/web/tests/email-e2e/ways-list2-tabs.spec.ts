// Other ways to a tab of the mail list: the app-wide go-to keys for Sent and
// for Email (on Signal), Escape back to Signal, and the Focus tab's own button.
// Navigation only, so the mailbox's provider decides nothing: Gmail alone.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { deliverThreads, listShows } from './harness/ways-list2';
import { did } from './ledger/record';

/** The tab the list's header says it shows. */
function shownTab(page: Page, name: string) {
  return page
    .getByRole('navigation', { name: 'Email location' })
    .getByRole('button', { name, exact: true });
}

test.describe('other ways to a tab of the mail list, in a Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, g then s leaves the list on the tab it was on (or
  // opens another), or Escape on a tab other than Signal no longer goes back
  // to Signal.
  test('g then s opens Sent, and Escape goes back to Signal', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverThreads(mailbox, ['Agenda']);
    const views = page.getByRole('radiogroup', { name: 'Inbox view' });

    await mailbox.open();
    await listShows(page, [ids.Agenda]);
    await page.keyboard.press('g');
    await page.keyboard.press('s');
    did('AL-912');
    await expect(shownTab(page, 'Sent')).toBeVisible();
    await expect(views).toHaveCount(0);

    // Escape, with nothing selected, is the way back.
    await page.keyboard.press('Escape');
    did('AL-008');
    await expect(shownTab(page, 'Inbox')).toBeVisible();
    await expect(views.getByRole('radio', { name: 'Signal' })).toBeChecked();
    await listShows(page, [ids.Agenda]);
  });

  // When this fails, g then e pressed elsewhere in the app does not open
  // Email, or opens it on the tab it was left on instead of Signal.
  test('g then e from another view opens Email on Signal', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverThreads(mailbox, ['Agenda']);
    const views = page.getByRole('radiogroup', { name: 'Inbox view' });

    await mailbox.open();
    await listShows(page, [ids.Agenda]);
    await page.keyboard.press('g');
    await page.keyboard.press('s');
    await expect(shownTab(page, 'Sent')).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('t');
    await expect(page).toHaveURL(/\/app\/tasks/);
    await expect(
      page.getByRole('complementary', { name: 'Tasks navigation' })
    ).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('e');
    did('AL-400');
    await expect(page).toHaveURL(/\/app\/mail/);
    await expect(shownTab(page, 'Inbox')).toBeVisible();
    await expect(views.getByRole('radio', { name: 'Signal' })).toBeChecked();
    await listShows(page, [ids.Agenda]);
  });

  // When this fails, the button of the Focus tab's "You're caught up" does
  // not lead to the rest of the inbox.
  test('the caught-up Focus tab leads to the rest of the inbox', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverThreads(mailbox, ['Agenda']);
    const views = page.getByRole('radiogroup', { name: 'Inbox view' });

    await mailbox.open();
    await listShows(page, [ids.Agenda]);
    await views.getByText('Focus', { exact: true }).click();
    await expect(views.getByRole('radio', { name: 'Focus' })).toBeChecked();
    await expect(page.getByText("You're caught up")).toBeVisible();
    await page
      .getByRole('button', { name: 'See the rest of your inbox' })
      .click();
    did('AL-047');
    await expect(views.getByRole('radio', { name: 'Signal' })).toBeChecked();
    await listShows(page, [ids.Agenda]);
  });
});
