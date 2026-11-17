// Other ways to a tab of the mail list: the go-to letters, Escape back to
// Signal, the app-wide go-to key for Email, and the Focus tab's own button.
// Navigation only, so the mailbox's provider decides nothing: Gmail alone.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { deliverThreads, listShows } from './harness/ways-list2';
import { did } from './ledger/record';

/**
 * g then this letter opens this tab, which the list's header names; Signal
 * and Noise are the two views of the Inbox.
 */
const LETTERS = [
  { key: 'o', tab: 'Inbox', view: 'Noise', fn: 'F-029' },
  { key: 'i', tab: 'Inbox', view: 'Signal', fn: 'F-029' },
  { key: 's', tab: 'Favorites', view: undefined, fn: 'F-030' },
  { key: 't', tab: 'Sent', view: undefined, fn: 'F-030' },
  { key: 'd', tab: 'Drafts', view: undefined, fn: 'F-030' },
  { key: 'e', tab: 'Archived', view: undefined, fn: 'F-030' },
  { key: 'a', tab: 'All', view: undefined, fn: 'F-030' },
] as const;

/** The tab the list's header says it shows. */
function shownTab(page: Page, name: string) {
  return page
    .getByRole('navigation', { name: 'Email location' })
    .getByRole('button', { name, exact: true });
}

test.describe('other ways to a tab of the mail list, in a Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, g followed by a tab's letter leaves the list on the tab
  // it was on (or opens another), or Escape on a tab other than Signal no
  // longer goes back to Signal.
  test('g and a letter opens each tab, and Escape goes back to Signal', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverThreads(mailbox, ['Agenda']);
    const views = page.getByRole('radiogroup', { name: 'Inbox view' });

    await mailbox.open();
    await listShows(page, [ids.Agenda]);
    for (const { key, tab, view, fn } of LETTERS) {
      await page.keyboard.press('g');
      await page.keyboard.press(key);
      did('AL-005', fn);
      await expect(shownTab(page, tab), `g ${key}`).toBeVisible();
      if (view) {
        await expect(views.getByRole('radio', { name: view })).toBeChecked();
      } else {
        await expect(views).toHaveCount(0);
      }
    }

    // On All mail now: Escape, with nothing selected, is the way back.
    await listShows(page, [ids.Agenda]);
    await page.keyboard.press('Escape');
    did('AL-008');
    await expect(shownTab(page, 'Inbox')).toBeVisible();
    await expect(views.getByRole('radio', { name: 'Signal' })).toBeChecked();
    await listShows(page, [ids.Agenda]);
  });

  // When this fails, g then e pressed elsewhere in the app does not open
  // Email.
  test('g then e from another view opens Email', async ({ page, mailbox }) => {
    const ids = await deliverThreads(mailbox, ['Agenda']);

    await mailbox.open('/app/tasks');
    await expect(page).toHaveURL(/\/app\/tasks/);
    await expect(
      page.getByRole('complementary', { name: 'Tasks navigation' })
    ).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('e');
    did('AL-400');
    await expect(page).toHaveURL(/\/app\/mail/);
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
