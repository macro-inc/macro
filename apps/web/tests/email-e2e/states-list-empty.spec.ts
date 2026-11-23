// What each tab of an empty mailbox shows in place of the list: its own
// title (Inbox zero, No noise, You're caught up with the way to Signal, ...),
// and the reading pane beside it with no conversation to show. Each for a
// Gmail and an Outlook inbox, on a desktop.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { emptyTitle, inboxTab, sidebarTab } from './harness/states-list';
import { did, saw } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`the empty tabs of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, an empty Inbox view (Signal, Noise, Focus) or an
    // empty Favorites, Drafts or Sent shows no title of its own, Focus
    // offers no way to the rest of the inbox, or the reading pane beside an
    // empty list does not say that no conversation is selected.
    test('the Inbox views, Favorites, Drafts and Sent each say they are empty', async ({
      page,
      mailbox,
    }) => {
      await page.setViewportSize({ width: 1600, height: 900 });
      await mailbox.open();

      await inboxTab(page, 'Signal');
      await expect(emptyTitle(page, 'Inbox zero')).toBeVisible();
      saw('STL-009');

      await inboxTab(page, 'Noise');
      await expect(emptyTitle(page, 'No noise')).toBeVisible();
      await expect(
        page.getByText(
          'Low-priority email like newsletters and notifications collects here. Nothing to clear right now.'
        )
      ).toBeVisible();
      saw('STL-010');

      await inboxTab(page, 'Focus');
      await expect(emptyTitle(page, "You're caught up")).toBeVisible();
      const rest = page.getByRole('button', {
        name: 'See the rest of your inbox',
      });
      await expect(rest).toBeVisible();
      saw('STL-019');
      await rest.click();
      await expect(
        page
          .getByRole('radiogroup', { name: 'Inbox view' })
          .getByRole('radio', { name: 'Signal' })
      ).toBeChecked();
      await expect(emptyTitle(page, 'Inbox zero')).toBeVisible();

      await sidebarTab(page, 'Favorites');
      await expect(emptyTitle(page, 'No favorite emails')).toBeVisible();
      saw('STL-011');

      await sidebarTab(page, 'Drafts');
      await expect(emptyTitle(page, 'No drafts')).toBeVisible();
      saw('STL-016');

      await sidebarTab(page, 'Sent');
      await expect(emptyTitle(page, 'No sent email')).toBeVisible();
      saw('STL-012');

      await page.keyboard.press('Shift+V');
      did('AL-036');
      const pane = page.getByRole('region', { name: 'Reading pane' });
      await expect(pane.getByText('No conversation selected')).toBeVisible();
      await expect(
        pane.getByText('Pick one from the list, or move with j and k')
      ).toBeVisible();
      saw('STL-028');
    });

    // When this fails, an empty All mail, Archived, Shared or Trash shows
    // no title of its own.
    test('All mail, Archived, Shared and Trash each say they are empty', async ({
      page,
      mailbox,
    }) => {
      await mailbox.open();

      await sidebarTab(page, 'All mail');
      await expect(emptyTitle(page, 'No email yet')).toBeVisible();
      saw('STL-022');

      await sidebarTab(page, 'Archived');
      await expect(emptyTitle(page, 'No archived email')).toBeVisible();
      saw('STL-018');

      await sidebarTab(page, 'Shared');
      await expect(emptyTitle(page, 'No shared email')).toBeVisible();
      saw('STL-017');

      await sidebarTab(page, 'Trash');
      await expect(emptyTitle(page, 'Trash is empty')).toBeVisible();
      saw('STL-021');
    });
  });
}
