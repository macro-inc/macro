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
import { keyboardInThread } from './harness/ways-thread-more';
import { did } from './ledger/record';

/**
 * Picks a tag in the open tag picker, a submenu of the menu it was opened
 * from, and closes that menu. Picking a tag's row saves it and closes the
 * picker alone; Escape then closes the menu.
 */
async function pickTag(page: Page, name: string): Promise<void> {
  const search = page.getByRole('textbox', { name: 'Change or add tags' });
  const picker = page.getByRole('menu').filter({ has: search });
  const trigger = page
    .getByRole('menu')
    .getByRole('menuitem', { name: /^Add tag/ });
  // The name is there twice: the row's checkbox label, for screen readers,
  // then the row's text. A click on the text picks the row.
  const tag = picker.getByText(name, { exact: true }).last();
  // The picker focuses its search once it has opened.
  await expect(search).toBeFocused();
  // A submenu closes when the pointer leaves another item of its menu, or
  // jumps onto the submenu in one step (Playwright's default). So the pointer
  // goes as a hand does: onto Add tag, along its row into the picker, then
  // down to the tag. The menu can have moved since the click that opened the
  // picker (the subject's menu does while the picker loads), leaving the
  // pointer on another item: moving off it closes the picker, and resting on
  // Add tag opens it again.
  const from = await trigger.boundingBox();
  if (!from) throw new Error('Add tag is not on screen');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  // Add tag takes the focus, so wait for the picker to be open (again) and
  // still instead.
  const open = page
    .locator('[role="menu"][data-expanded]')
    .filter({ has: search });
  await expect(open).toBeVisible();
  await open.evaluate((menu) =>
    Promise.allSettled(
      menu.getAnimations({ subtree: true }).map((each) => each.finished)
    )
  );
  const row = await trigger.boundingBox();
  const box = await tag.boundingBox();
  if (!row || !box) throw new Error(`the tag ${name} is not on screen`);
  const x = box.x + box.width / 2;
  await page.mouse.move(x, row.y + row.height / 2, { steps: 10 });
  await page.mouse.move(x, box.y + box.height / 2, { steps: 5 });
  await tag.click();
  await expect(picker).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
}

for (const provider of PROVIDERS) {
  test.describe(`filing a thread of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Move to folder in a row's menu opens no folder
    // picker, one that closes at once (the row menu's own dismissal reaching
    // it), or one that leaves the thread out of the folder named there.
    test("Move to folder in a row's menu files the thread", async ({
      page,
      mailbox,
    }) => {
      const ids = await deliverAll(mailbox, ['Agenda']);
      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([ids.Agenda]);
      await rowMenu(page, ids.Agenda, /^Move to folder/);
      did('AL-091');
      await pickFolder(page, 'Receipts', /^New folder/);
      await expect
        .poll(async () =>
          folderName(mailbox, await folderOf(mailbox, ids.Agenda))
        )
        .toBe('Receipts');
    });

    // When this fails, Move to folder in the menu after an open thread's
    // subject leaves the thread out of the folder picked (or named there as
    // a new one).
    test('moving an open thread to a folder, new and existing', async ({
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
      await openFromList(page, ids.Agenda, 'About Agenda.');
      await titleMenu(page, 'Agenda', /^Move to folder/);
      did('AL-155');
      await pickFolder(page, 'Receipts', /^New folder/);
      await expect.poll(folder(ids.Agenda)).toBe('Receipts');

      // The picker leaves the keyboard on the page, where Escape closes
      // nothing: back in the thread it closes the thread.
      await keyboardInThread(page, 'Agenda');
      await backToList(page);
      await openFromList(page, ids.Minutes, 'About Minutes.');
      await titleMenu(page, 'Minutes', /^Move to folder/);
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
