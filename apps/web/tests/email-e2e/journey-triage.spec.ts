// Journey: sorting through the inbox from the list. Several rows selected
// and marked done at once, one moved to Trash and restored from there, one
// marked unread and read again, one starred; and a message the provider put
// in spam brought back. The same journey for a Gmail and an Outlook inbox;
// each step but the star, a Macro favorite, is checked at the provider.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import {
  deliverToSpam,
  spamFolder,
  syncedInView,
  trashFolder,
} from './harness/journeys';
import { focusRow, rowIds } from './harness/list';
import { notice } from './harness/send';
import type { Provider } from './harness/stack';

/** The row of a thread in the list. */
function row(page: Page, threadId: string) {
  return page.locator(`[data-soup-entity] [data-entity-id="${threadId}"]`);
}

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`triage in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a triage action shows its notice but the provider keeps
    // the old state: still in the inbox, not in Trash, or read or unread.
    test('bulk done, Trash and restore, unread and read, star', async ({
      page,
      mailbox,
    }) => {
      const from = 'Grace <grace@example.com>';
      const subjects = ['Agenda', 'Minutes', 'Old invoice', 'Question'];
      for (const subject of subjects) {
        await mailbox.deliver({ from, subject, text: `About ${subject}.` });
      }
      const ids: Record<string, string> = {};
      for (const subject of subjects) {
        ids[subject] = (await mailbox.synced(subject)).id;
      }
      const held = async (subject: string) =>
        (await mailbox.providerMessages()).find(
          (message) => message.subject === subject
        );
      const library = page.getByRole('navigation', { name: 'Email library' });
      const tabs = page.getByRole('navigation', { name: 'Email tabs' });

      await mailbox.open();

      // Two rows selected and marked done together.
      for (const subject of ['Agenda', 'Minutes']) {
        await row(page, ids[subject]).hover();
        await row(page, ids[subject])
          .getByRole('checkbox', { name: 'Select item' })
          .click();
      }
      await expect(page.getByText('2 selected')).toBeVisible();
      await page.keyboard.press('e');
      await expect(notice(page, 'Marked 2 items as done')).toBeVisible();
      await expect(row(page, ids.Agenda)).toHaveCount(0);
      await expect(row(page, ids.Minutes)).toHaveCount(0);
      await expect
        .poll(async () => [
          (await held('Agenda'))?.inInbox,
          (await held('Minutes'))?.inInbox,
        ])
        .toEqual([false, false]);
      expect((await held('Question'))?.inInbox).toBe(true);

      // One to Trash.
      await focusRow(page, ids['Old invoice']);
      // '#' as a keyboard types it: Shift with the 3 key.
      await page.keyboard.press('Shift+Digit3');
      await expect(notice(page, 'Moved to Trash')).toBeVisible();
      await expect(row(page, ids['Old invoice'])).toHaveCount(0);
      await expect
        .poll(async () => (await held('Old invoice'))?.labels)
        .toContain(trashFolder(provider));

      // Read, unread, read again.
      await row(page, ids.Question).click();
      await expect(page.getByText('About Question.')).toBeVisible();
      await expect.poll(async () => (await held('Question'))?.read).toBe(true);
      // Back to the list in the app, as a user does: a reload here can cut
      // off a read still in flight, which holds the mutation queue.
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(/\/app\/mail$/);
      await focusRow(page, ids.Question);
      await page.keyboard.press('u');
      await expect(notice(page, 'Marked as unread')).toBeVisible();
      await expect.poll(async () => (await held('Question'))?.read).toBe(false);
      await page.keyboard.press('Shift+U');
      await expect(notice(page, 'Marked as read')).toBeVisible();
      await expect.poll(async () => (await held('Question'))?.read).toBe(true);

      // Starred: Favorites lists it.
      await page.keyboard.press('s');
      await expect(notice(page, 'Added to favorites')).toBeVisible();
      await tabs.getByRole('button', { name: 'Favorites' }).click();
      await expect.poll(() => rowIds(page)).toEqual([ids.Question]);

      // Restored from Trash: back in the inbox at the provider.
      await library.getByRole('button', { name: 'Trash' }).click();
      await expect(page).toHaveURL(/tab=trash/);
      await expect.poll(() => rowIds(page)).toEqual([ids['Old invoice']]);
      await row(page, ids['Old invoice']).hover();
      await row(page, ids['Old invoice'])
        .getByRole('button', { name: 'Restore' })
        .click();
      await expect(notice(page, 'Restore requested')).toBeVisible();
      await expect
        .poll(async () => (await held('Old invoice'))?.inInbox)
        .toBe(true);
      expect((await held('Old invoice'))?.labels).not.toContain(
        trashFolder(provider)
      );
    });

    // Class web-gmail-not-spam-stays-archived: when this fails on Gmail, Not
    // spam only takes the SPAM label off, so the message lands in All Mail
    // and never comes back to the inbox, at Gmail or in Macro. Outlook moves
    // it to the Inbox folder, as Gmail's own Not spam does.
    test(`${provider === 'GMAIL' ? 'known bug: web-gmail-not-spam-stays-archived: ' : ''}not spam brings a message from spam back to the inbox`, {
      tag: provider === 'GMAIL' ? '@known-bug' : [],
    }, async ({ page, mailbox }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Agenda',
        text: 'About Agenda.',
      });
      await deliverToSpam(mailbox, {
        from: 'Hal <hal@example.com>',
        subject: 'Team photos',
        text: 'The photos from Friday.',
      });
      await mailbox.synced('Agenda');
      const photos = await syncedInView(mailbox, 'spam', 'Team photos');
      const held = async () =>
        (await mailbox.providerMessages()).find(
          (message) => message.subject === 'Team photos'
        );
      const library = page.getByRole('navigation', { name: 'Email library' });

      await mailbox.open();
      await library.getByRole('button', { name: 'Spam' }).click();
      await expect(page).toHaveURL(/tab=spam/);
      await expect.poll(() => rowIds(page)).toEqual([photos]);
      await row(page, photos).hover();
      await row(page, photos).getByRole('button', { name: 'Not spam' }).click();
      await expect(notice(page, 'Restore requested')).toBeVisible();
      await expect(page.getByText('No spam')).toBeVisible();
      await expect
        .poll(async () => (await held())?.labels)
        .not.toContain(spamFolder(provider));
      expect((await held())?.inInbox).toBe(true);

      // Back in Macro's inbox too.
      await mailbox.open();
      await expect.poll(() => rowIds(page)).toContain(photos);
    });
  });
}
