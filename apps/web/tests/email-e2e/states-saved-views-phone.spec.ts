// What a phone shows of saved views: the list header's name for the open
// view, and the row menus of the sidebar sheet's Saved views, which move a
// view only where it has a neighbour. Each for a Gmail and an Outlook inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  openSidebarSheet,
  openTouchTab,
  PHONE,
  sidebarSheet,
  touchHeaderName,
} from './harness/ways-list1';
import {
  closeMenus,
  listedNames,
  storedNames,
  storeView,
  viewRow,
} from './harness/ways-saved-views';
import { saw } from './ledger/record';

const from = 'Grace <grace@example.com>';

for (const provider of PROVIDERS) {
  test.describe(`the saved views' states on a phone, ${anInbox(provider)}`, () => {
    test.use({ ...PHONE, provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // Known bug touch-header-saved-view-name: the touch header names the tab
    // a view runs on (All) instead of the view, which the desktop header
    // names. When this passes, the bug is fixed: remove the tag.
    test('known bug: touch-header-saved-view-name: the header names the open view while it is open @known-bug', {
      tag: '@known-bug',
    }, async ({ page, mailbox }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      await mailbox.deliver({ from, subject: 'Beta', text: 'Body of Beta.' });
      const alpha = await mailbox.synced('Alpha');
      const beta = await mailbox.synced('Beta');
      await storeView(mailbox, 'Alpha mail', { subject: ['Alpha'] });
      const pill = (name: string) =>
        page.getByRole('main').getByRole('button', { name, exact: true });

      await mailbox.open();
      // The phone layout, not a desktop one squeezed by touch emulation.
      expect(await page.evaluate(() => window.innerWidth)).toBe(
        PHONE.viewport.width
      );
      await expect.poll(() => rowIds(page)).toEqual([beta.id, alpha.id]);

      await openSidebarSheet(page);
      await viewRow(page, 'Alpha mail').tap();
      await expect(sidebarSheet(page)).toHaveCount(0);
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      await expect(touchHeaderName(page, 'Alpha mail')).toBeVisible();
      await expect(touchHeaderName(page, 'All')).toHaveCount(0);

      // Left for the Signal tab, the header has its pills again.
      await openTouchTab(page, 'Signal');
      await expect(pill('Signal')).toHaveAttribute('aria-pressed', 'true');
      await expect(touchHeaderName(page, 'Alpha mail')).toHaveCount(0);
      saw('STL-704');
      await expect.poll(() => rowIds(page)).toEqual([beta.id, alpha.id]);
    });

    // If the sheet loses the Move items, a tap cannot change the order.
    test('row menus of the sheet move a view only where they can', async ({
      page,
      mailbox,
    }) => {
      await storeView(mailbox, 'Alpha mail', { subject: ['Alpha'] });
      await storeView(mailbox, 'Beta mail', { subject: ['Beta'] });
      const stored = await storedNames(mailbox);
      const [upper, lower] = stored;
      const sheet = sidebarSheet(page);
      const moveUp = page.getByRole('menuitem', { name: 'Move up' });
      const moveDown = page.getByRole('menuitem', { name: 'Move down' });

      await mailbox.open();
      await openSidebarSheet(page);
      await expect.poll(() => listedNames(page)).toEqual(stored);
      // The top view only moves down, the bottom one only up.
      await sheet.getByRole('button', { name: `Actions for ${upper}` }).tap();
      await expect(moveDown).toBeVisible({ timeout: 5_000 });
      await expect(moveUp).toHaveCount(0);
      await closeMenus(page);
      await sheet.getByRole('button', { name: `Actions for ${lower}` }).tap();
      await expect(moveUp).toBeVisible();
      await expect(moveDown).toHaveCount(0);
      saw('STL-711');
    });
  });
}
