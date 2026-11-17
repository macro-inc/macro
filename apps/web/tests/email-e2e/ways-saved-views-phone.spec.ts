// Saved views on a phone: the header's Show sidebar opens the Email sidebar
// as a sheet, whose Saved views section starts the builder with New saved
// view, opens a view from its rows, and moves a view up and down from a
// row's menu. Each for a Gmail and an Outlook inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { openSidebarSheet, PHONE, sidebarSheet } from './harness/ways-list1';
import {
  listedNames,
  storedNames,
  storedView,
  storeView,
  viewRow,
} from './harness/ways-saved-views';
import { did } from './ledger/record';

const from = 'Grace <grace@example.com>';

for (const provider of PROVIDERS) {
  test.describe(`saved views on a phone, ${anInbox(provider)}`, () => {
    test.use({ ...PHONE, provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a phone has no way to its saved views: Show sidebar
    // opens no sheet, the sheet's New saved view starts no builder, or a
    // tapped view does not open with its mail.
    test('the sidebar sheet creates a view and opens one', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      await mailbox.deliver({ from, subject: 'Beta', text: 'Body of Beta.' });
      const alpha = await mailbox.synced('Alpha');
      const beta = await mailbox.synced('Beta');
      const sheet = sidebarSheet(page);
      const builder = page.getByRole('dialog', { name: 'Save view' });

      await mailbox.open();
      // The phone layout, not a desktop one squeezed by touch emulation.
      expect(await page.evaluate(() => window.innerWidth)).toBe(
        PHONE.viewport.width
      );
      await expect.poll(() => rowIds(page)).toEqual([beta.id, alpha.id]);

      await openSidebarSheet(page);
      await sheet.getByRole('button', { name: 'New saved view' }).tap();
      did('AL-106');
      await builder.getByRole('textbox', { name: 'Name' }).fill('Alpha mail');
      await builder
        .getByRole('textbox', { name: 'Subject contains' })
        .fill('Alpha');
      await builder.getByRole('button', { name: 'Save view' }).tap();
      await expect(builder).toHaveCount(0);
      await expect
        .poll(async () => (await storedView(mailbox, 'Alpha mail'))?.filters)
        .toMatchObject({ subject: ['Alpha'] });
      // The new view opens with its mail.
      await expect(page).toHaveURL(/savedView=/);
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);

      // A second view, made elsewhere, shows once the app loads again.
      await storeView(mailbox, 'Beta mail', { subject: ['Beta'] });
      const stored = await storedNames(mailbox);
      expect([...stored].sort()).toEqual(['Alpha mail', 'Beta mail']);
      await page.reload();
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      await openSidebarSheet(page);
      await expect.poll(() => listedNames(page)).toEqual(stored);
      await viewRow(page, 'Beta mail').tap();
      did('AL-105');
      // The sheet goes before the view's mail comes.
      await expect(sheet).toHaveCount(0);
      await expect.poll(() => rowIds(page)).toEqual([beta.id]);
    });

    // Known bug touch-saved-views-reorder: the sheet lists the desktop's
    // rows, which reorder by a mouse drag alone, so their menus have no Move
    // up or Move down and a touch cannot reorder views. When this passes,
    // the bug is fixed: remove the tag.
    test('known bug: touch-saved-views-reorder: Move up and Move down in a row menu of the sheet reorder the views @known-bug', {
      tag: '@known-bug',
    }, async ({ page, mailbox }) => {
      await storeView(mailbox, 'Alpha mail', { subject: ['Alpha'] });
      await storeView(mailbox, 'Beta mail', { subject: ['Beta'] });
      const stored = await storedNames(mailbox);
      const [upper, lower] = stored;
      const sheet = sidebarSheet(page);

      await mailbox.open();
      await openSidebarSheet(page);
      await expect.poll(() => listedNames(page)).toEqual(stored);
      await sheet.getByRole('button', { name: `Actions for ${lower}` }).tap();
      await page.getByRole('menuitem', { name: 'Move up' }).tap();
      did('AL-115');
      await expect.poll(() => listedNames(page)).toEqual([lower, upper]);
      await expect.poll(() => storedNames(mailbox)).toEqual([lower, upper]);
      await sheet.getByRole('button', { name: `Actions for ${lower}` }).tap();
      await page.getByRole('menuitem', { name: 'Move down' }).tap();
      await expect.poll(() => listedNames(page)).toEqual([upper, lower]);
      await expect.poll(() => storedNames(mailbox)).toEqual([upper, lower]);
    });
  });
}
