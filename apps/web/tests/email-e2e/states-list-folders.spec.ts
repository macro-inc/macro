// What Spam and Trash offer to bring mail back: a row's own button, named
// "Not spam" in Spam and "Restore" in Trash, and the selection toolbar's
// Restore, which waits while a restore is on its way. Each for a Gmail and
// an Outlook inbox.

import type { Route } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { deliverToSpam, syncedInView } from './harness/journeys';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  deliverToTrash,
  sidebarTab,
  toolbarButton,
} from './harness/states-list';
import { GRACE } from './harness/ways-list1';
import { listShows, row, rowCheckbox } from './harness/ways-list2';
import { did, saw } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`bringing mail back from Spam and Trash of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a row in Spam offers no "Not spam" or a row in Trash
    // no "Restore", the selection toolbar in Trash has no Restore, or it
    // can be pressed again while a restore is on its way (or stays
    // disabled, or drops the selection, once that restore failed).
    test('rows offer Not spam and Restore, and the toolbar Restore waits for the restore', async ({
      page,
      mailbox,
    }) => {
      await deliverToSpam(mailbox, {
        from: GRACE,
        subject: 'Team photos',
        text: 'From the offsite.',
      });
      for (const subject of ['Old invoice', 'Older invoice'])
        await deliverToTrash(mailbox, { from: GRACE, subject, text: 'Paid.' });
      const spam = await syncedInView(mailbox, 'spam', 'Team photos');
      const trashed = [
        await syncedInView(mailbox, 'trash', 'Old invoice'),
        await syncedInView(mailbox, 'trash', 'Older invoice'),
      ];
      // Every restore waits until the test lets it fail, and so do the
      // service client's tries again.
      const held: Route[] = [];
      let failing = false;
      await page.route(/\/email\/threads\/[^/]+\/state(\?|$)/, (route) => {
        if (failing) return route.fulfill({ status: 500, body: '{}' });
        held.push(route);
      });

      await mailbox.open();
      await sidebarTab(page, 'Spam');
      await listShows(page, [spam]);
      await row(page, spam).hover();
      await expect(
        row(page, spam).getByRole('button', { name: 'Not spam', exact: true })
      ).toBeVisible();
      saw('STL-038', 'F-078');

      await sidebarTab(page, 'Trash');
      await listShows(page, trashed);
      await row(page, trashed[0]).hover();
      await expect(
        row(page, trashed[0]).getByRole('button', {
          name: 'Restore',
          exact: true,
        })
      ).toBeVisible();
      saw('STL-038', 'F-076');

      for (const id of trashed) await (await rowCheckbox(page, id)).click();
      await expect(page.getByText('2 selected')).toBeVisible();
      const restore = toolbarButton(page, 'Restore');
      await expect(restore).toBeEnabled();
      await restore.click();
      did('AL-406', 'F-076');
      await expect.poll(() => held.length).toBe(2);
      await expect(restore).toBeDisabled();
      saw('STL-402');

      failing = true;
      for (const route of held.splice(0))
        await route.fulfill({ status: 500, body: '{}' });
      await expect(restore).toBeEnabled();
      await expect(page.getByText('2 selected')).toBeVisible();
      await listShows(page, trashed);
    });
  });
}
