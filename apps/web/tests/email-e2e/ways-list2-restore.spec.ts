// The selection toolbar's way out of Trash and Spam: Restore and Not spam on
// the bar that shows while rows are selected. Each for a Gmail and an
// Outlook inbox.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import {
  deliverToSpam,
  spamFolder,
  syncedInView,
  trashFolder,
} from './harness/journeys';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  deliverThreads,
  held,
  listShows,
  rowCheckbox,
} from './harness/ways-list2';
import { confirmed, did } from './ledger/record';

/** A button of the selection toolbar: the rows have one of the same name. */
function toolbarButton(page: Page, name: string) {
  return page
    .getByRole('button', { name, exact: true })
    .and(page.locator(':not([data-entity-id] *)'));
}

for (const provider of PROVIDERS) {
  test.describe(`the selection toolbar in Trash and Spam of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Restore on the selection toolbar leaves the selected
    // threads in the provider's trash, or brings back only one of them.
    test("the toolbar's Restore brings the selected threads back from Trash", async ({
      page,
      mailbox,
    }) => {
      const subjects = ['Old invoice', 'Older invoice'];
      const ids = await deliverThreads(mailbox, [...subjects, 'Agenda']);
      const trashed = subjects.map((subject) => ids[subject]);

      await mailbox.open();
      await listShows(page, Object.values(ids));
      for (const id of trashed) await (await rowCheckbox(page, id)).click();
      await expect(page.getByText('2 selected')).toBeVisible();
      await page.keyboard.press('Shift+Digit3');
      for (const subject of subjects) {
        await expect
          .poll(async () => (await held(mailbox, subject))?.labels)
          .toContain(trashFolder(provider));
      }

      await page
        .getByRole('navigation', { name: 'Email library' })
        .getByRole('button', { name: 'Trash' })
        .click();
      await listShows(page, trashed);
      for (const id of trashed) await (await rowCheckbox(page, id)).click();
      await expect(page.getByText('2 selected')).toBeVisible();
      await toolbarButton(page, 'Restore').click();
      did('AL-406', 'F-076');
      did('AL-406', 'F-082');
      // Gmail keeps INBOX on a trashed message, so the inbox alone says
      // nothing there: the trash label has to go.
      for (const subject of subjects) {
        await expect
          .poll(async () => (await held(mailbox, subject))?.labels)
          .not.toContain(trashFolder(provider));
        await expect
          .poll(async () => (await held(mailbox, subject))?.inInbox)
          .toBe(true);
      }
      confirmed('F-076');
      confirmed('F-082');
      await listShows(page, []);
    });

    // When this fails, the toolbar's Not spam leaves the selected thread in
    // Spam or Junk, or takes it out without bringing it back to the inbox.
    test("the toolbar's Not spam brings the selected thread back to the inbox", async ({
      page,
      mailbox,
    }) => {
      await deliverThreads(mailbox, ['Agenda']);
      await deliverToSpam(mailbox, {
        from: 'Hal <hal@example.com>',
        subject: 'Team photos',
        text: 'The photos from Friday.',
      });
      const photos = await syncedInView(mailbox, 'spam', 'Team photos');

      await mailbox.open();
      await page
        .getByRole('navigation', { name: 'Email library' })
        .getByRole('button', { name: 'Spam' })
        .click();
      await listShows(page, [photos]);
      await (await rowCheckbox(page, photos)).click();
      await expect(page.getByText('1 selected')).toBeVisible();
      await toolbarButton(page, 'Not spam').click();
      did('AL-406', 'F-078');
      await expect
        .poll(async () => (await held(mailbox, 'Team photos'))?.labels)
        .not.toContain(spamFolder(provider));
      await expect
        .poll(async () => (await held(mailbox, 'Team photos'))?.inInbox)
        .toBe(true);
      confirmed('F-078');
    });
  });
}
