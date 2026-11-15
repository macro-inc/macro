// What the phone's saved views picker shows: its pill, named after the open
// view and pressed while one is open, and its drawer's row menus, which move
// a view only where it has a neighbour. Each for a Gmail and an Outlook inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { PHONE } from './harness/states-saved-views';
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
  test.describe(`the saved views picker's states on a phone, ${anInbox(provider)}`, () => {
    test.use({ ...PHONE, provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the phone's pill does not say which view is open (or
    // that one is), keeps the view's name after the view is left, or a row
    // menu of the drawer offers to move a view past either end of the list.
    test('the pill names the open view while it is open, and row menus move only where they can', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      await mailbox.deliver({ from, subject: 'Beta', text: 'Body of Beta.' });
      const alpha = await mailbox.synced('Alpha');
      const beta = await mailbox.synced('Beta');
      await storeView(mailbox, 'Alpha mail', { subject: ['Alpha'] });
      await storeView(mailbox, 'Beta mail', { subject: ['Beta'] });
      const stored = await storedNames(mailbox);
      const [upper, lower] = stored;
      const drawer = page.getByRole('dialog', { name: 'Saved views' });
      const pill = (name: string) =>
        page.getByRole('button', { name, exact: true });
      const moveUp = page.getByRole('menuitem', { name: 'Move up' });
      const moveDown = page.getByRole('menuitem', { name: 'Move down' });

      await mailbox.open();
      // The phone layout, not a desktop one squeezed by touch emulation.
      expect(await page.evaluate(() => window.innerWidth)).toBe(
        PHONE.viewport.width
      );
      await expect.poll(() => rowIds(page)).toEqual([beta.id, alpha.id]);
      await expect(pill('Saved views')).toHaveAttribute(
        'aria-pressed',
        'false'
      );

      // The drawer's row menus: the top view only moves down, the bottom
      // one only up.
      await pill('Saved views').tap();
      await expect.poll(() => listedNames(page)).toEqual(stored);
      await drawer.getByRole('button', { name: `Actions for ${upper}` }).tap();
      await expect(moveDown).toBeVisible();
      await expect(moveUp).toHaveCount(0);
      await closeMenus(page);
      await drawer.getByRole('button', { name: `Actions for ${lower}` }).tap();
      await expect(moveUp).toBeVisible();
      await expect(moveDown).toHaveCount(0);
      saw('STL-711');
      await closeMenus(page);

      // A view opened from the drawer, then left for the Signal tab.
      await viewRow(page, lower).tap();
      await expect(drawer).toHaveCount(0);
      await expect(pill(lower)).toHaveAttribute('aria-pressed', 'true');
      await expect(pill('Saved views')).toHaveCount(0);
      await expect(pill('Signal')).toHaveAttribute('aria-pressed', 'false');
      await pill('Signal').tap();
      await expect(pill('Signal')).toHaveAttribute('aria-pressed', 'true');
      await expect(pill('Saved views')).toHaveAttribute(
        'aria-pressed',
        'false'
      );
      await expect(pill(lower)).toHaveCount(0);
      saw('STL-704');
      await expect.poll(() => rowIds(page)).toEqual([beta.id, alpha.id]);
    });
  });
}
