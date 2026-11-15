// The ways to file a thread and to sort its sender, besides the shortcuts
// and the command menu: the row's context menu and the menu after the open
// thread's subject. Each for a Gmail and an Outlook inbox.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { createTag, threadTagIds } from './harness/organise';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import {
  backToList,
  blocked,
  deliverAll,
  folderOf,
  openFromList,
  rowMenu,
  senderFilters,
  titleMenu,
} from './harness/ways-organise';
import { folderName, pickFolder } from './harness/ways-organise-more';
import { did } from './ledger/record';

/** Picks a tag in the open tag picker, and closes it. */
async function pickTag(page: Page, name: string): Promise<void> {
  const picker = page.getByRole('dialog').filter({
    has: page.getByRole('textbox', { name: 'Change or add tags' }),
  });
  await picker.getByText(name, { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
}

for (const provider of PROVIDERS) {
  test.describe(`filing a thread of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Move to folder in the row's menu or in the menu after
    // an open thread's subject leaves the thread out of the folder picked
    // (or named there as a new one).
    test('every way to move a thread to a folder', async ({
      page,
      mailbox,
    }) => {
      const ids = await deliverAll(mailbox, ['Agenda', 'Minutes', 'Kept']);
      const folder = (id: string) => async () =>
        folderName(mailbox, await folderOf(mailbox, id));

      await mailbox.open();
      await expect
        .poll(() => rowIds(page))
        .toEqual(expect.arrayContaining(Object.values(ids)));
      await rowMenu(page, ids.Agenda, /^Move to folder/);
      did('AL-091');
      await pickFolder(page, 'Receipts', /^New folder/);
      await expect.poll(folder(ids.Agenda)).toBe('Receipts');

      await openFromList(page, ids.Minutes, 'About Minutes.');
      await titleMenu(page, 'Minutes', /^Move to folder/);
      did('AL-155');
      await pickFolder(page, 'Receipts', /^Receipts/);
      await expect.poll(folder(ids.Minutes)).toBe('Receipts');
      // Both went to the one folder: the second picked it, not a new one.
      expect(await folderOf(mailbox, ids.Minutes)).toBe(
        await folderOf(mailbox, ids.Agenda)
      );
      expect(await folderOf(mailbox, ids.Kept)).toBeUndefined();
    });

    // When this fails, Add tag in the row's menu or in the menu after an
    // open thread's subject opens no tag picker, or the tag picked there is
    // not stored on the thread.
    test('every way to tag a thread', async ({ page, mailbox }) => {
      const ids = await deliverAll(mailbox, ['Agenda', 'Minutes', 'Kept']);
      const tag = await createTag(mailbox, 'urgent');

      await mailbox.open();
      await expect
        .poll(() => rowIds(page))
        .toEqual(expect.arrayContaining(Object.values(ids)));
      await rowMenu(page, ids.Agenda, /^Add tag/);
      did('AL-083');
      await pickTag(page, 'urgent');
      await expect
        .poll(() => threadTagIds(mailbox, ids.Agenda))
        .toEqual([tag.optionId]);

      await openFromList(page, ids.Minutes, 'About Minutes.');
      await titleMenu(page, 'Minutes', /^Add tag/);
      did('AL-615');
      await pickTag(page, 'urgent');
      await expect
        .poll(() => threadTagIds(mailbox, ids.Minutes))
        .toEqual([tag.optionId]);
      expect(await threadTagIds(mailbox, ids.Kept)).toEqual([]);
    });

    // When this fails, Sender → Noise, Sender → Signal or Block Sender in
    // the menu after an open thread's subject saves no filter or no block
    // for the thread's sender, or one for somebody else.
    test("the menu after the subject sorts the thread's sender, and blocks one", async ({
      page,
      mailbox,
    }) => {
      const ids = {
        ...(await deliverAll(mailbox, ['Agenda'])),
        ...(await deliverAll(mailbox, ['Photos'], 'Hal <hal@example.com>')),
      };

      await mailbox.open();
      await expect
        .poll(() => rowIds(page))
        .toEqual(expect.arrayContaining(Object.values(ids)));
      await openFromList(page, ids.Agenda, 'About Agenda.');
      await titleMenu(page, 'Agenda', 'Sender → Noise');
      did('AL-159');
      await expect
        .poll(() => senderFilters(mailbox))
        .toEqual([{ address: 'grace@example.com', signal: false }]);
      await expect(notice(page, 'Sender marked as Noise')).toBeVisible();
      await titleMenu(page, 'Agenda', 'Sender → Signal');
      did('AL-158');
      await expect
        .poll(() => senderFilters(mailbox))
        .toEqual([{ address: 'grace@example.com', signal: true }]);

      await backToList(page);
      await openFromList(page, ids.Photos, 'About Photos.');
      await titleMenu(page, 'Photos', 'Block Sender');
      did('AL-160');
      await expect(notice(page, 'Sender block queued')).toBeVisible();
      await expect.poll(() => blocked(mailbox)).toEqual(['hal@example.com']);
    });
  });
}
