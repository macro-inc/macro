// The touch sidebar sheet starts the builder, opens a view, and offers
// Move up and Move down. Reordering is exercised at phone and tablet widths.

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
import { confirmed, did, saw } from './ledger/record';

const from = 'Grace <grace@example.com>';
const TABLET = { ...PHONE, viewport: { width: 1024, height: 768 } };

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
  });

  for (const [layout, device] of [
    ['phone', PHONE],
    ['tablet', TABLET],
  ] as const) {
    test.describe(`saved-view order on a ${layout}, ${anInbox(provider)}`, () => {
      test.use({ ...device, provider });
      test.beforeEach(({ page }) => loadAppSteadily(page));

      // If the sheet loses its Move items, there is no way to save a new
      // order by touch.
      test('Move up and Move down in a row menu of the sheet reorder the views', async ({
        page,
        mailbox,
      }) => {
        await storeView(mailbox, 'Alpha mail', { subject: ['Alpha'] });
        await storeView(mailbox, 'Beta mail', { subject: ['Beta'] });
        const stored = await storedNames(mailbox);
        const [upper, lower] = stored;
        const sheet = sidebarSheet(page);
        const actions = sheet.getByRole('button', {
          name: `Actions for ${lower}`,
        });
        const moveUp = page.getByRole('menuitem', { name: 'Move up' });
        const moveDown = page.getByRole('menuitem', { name: 'Move down' });

        await mailbox.open();
        expect(await page.evaluate(() => window.innerWidth)).toBe(
          device.viewport.width
        );
        await openSidebarSheet(page);
        await expect.poll(() => listedNames(page)).toEqual(stored);
        await actions.tap();
        await expect(moveUp).toBeVisible({ timeout: 5_000 });
        await moveUp.tap();
        did('AL-115');
        await expect.poll(() => listedNames(page)).toEqual([lower, upper]);
        saw('STL-702');
        await expect.poll(() => storedNames(mailbox)).toEqual([lower, upper]);

        await page.reload();
        await openSidebarSheet(page);
        await expect.poll(() => listedNames(page)).toEqual([lower, upper]);
        await actions.tap();
        await moveDown.tap();
        await expect.poll(() => listedNames(page)).toEqual(stored);
        await expect.poll(() => storedNames(mailbox)).toEqual(stored);
        confirmed('F-049');
      });
    });
  }
}
