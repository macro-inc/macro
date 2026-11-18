// Other ways to move the list's cursor and to open a row's menus: the keys
// that jump to the first and the last row, the command menu from the list,
// the row's context menu and its lightning button. Focus and menus only, so
// the mailbox's provider decides nothing: Gmail alone.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { focusedRowId, rowIds } from './harness/list';
import {
  deliverThreads,
  listShows,
  row,
  rowCheckbox,
  selectedIds,
} from './harness/ways-list2';
import { did } from './ledger/record';

/** Each key that jumps, and the end of the list it jumps to. */
const JUMPS = [
  { keys: ['End'], to: 'last' },
  { keys: ['Home'], to: 'first' },
  { keys: ['Shift+G'], to: 'last' },
  { keys: ['ControlOrMeta+ArrowUp'], to: 'first' },
  { keys: ['ControlOrMeta+ArrowDown'], to: 'last' },
  { keys: ['g', 'g'], to: 'first' },
] as const;

test.describe("other ways to move the list's cursor, in a Gmail inbox", () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, one of Home, Cmd+ArrowUp, g g (first row) or End,
  // Shift+G, Cmd+ArrowDown (last row) leaves the cursor where it was.
  test('each key that jumps puts the cursor on the first or the last row', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverThreads(mailbox, [
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
    ]);

    await mailbox.open();
    await listShows(page, Object.values(ids));
    const rows = await rowIds(page);
    await expect.poll(() => focusedRowId(page)).toBeDefined();
    for (const { keys, to } of JUMPS) {
      for (const key of keys) await page.keyboard.press(key);
      did('AL-049');
      await expect
        .poll(() => focusedRowId(page), { message: keys.join(' ') })
        .toBe(to === 'first' ? rows[0] : rows[rows.length - 1]);
    }
  });

  // When this fails, Cmd+K on the list opens no command menu, a right-click
  // on a row opens no menu of the thread's actions, or the row's lightning
  // button opens no command menu for that thread.
  test('the command menu, the context menu and the lightning button open from a row', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverThreads(mailbox, ['Agenda', 'Minutes']);
    const search = page.getByRole('textbox', { name: 'Search actions...' });
    const results = page.getByRole('listbox', { name: 'Search results' });

    await mailbox.open();
    await listShows(page, Object.values(ids));

    // Nothing selected: the app's command menu, not a thread's actions.
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog');
    await expect(palette.getByRole('textbox')).toBeFocused();
    await expect(search).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);

    // A row selected: the list's own binding opens that thread's actions,
    // which the app-wide Ctrl+K does not.
    await (await rowCheckbox(page, ids.Minutes)).click();
    expect(await selectedIds(page)).toEqual([ids.Minutes]);
    await page.keyboard.press('ControlOrMeta+k');
    did('AL-402');
    await expect(search).toBeVisible();
    await expect(
      results.getByRole('option', { name: /^Mark done/ })
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(search).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect.poll(() => selectedIds(page)).toEqual([]);

    await row(page, ids.Minutes).click({ button: 'right' });
    did('AL-411');
    const menu = page.getByRole('menu');
    await expect(
      menu.getByRole('menuitem', { name: /^Mark Done/ })
    ).toBeVisible();
    await menu.press('Escape');
    await expect(menu).toHaveCount(0);

    await row(page, ids.Agenda).hover();
    await row(page, ids.Agenda)
      .getByRole('button', { name: 'Open command menu' })
      .click();
    did('AL-077');
    await expect(search).toBeVisible();
    await expect(
      results.getByRole('option', { name: /^Mark done/ })
    ).toBeVisible();
    // It is the menu of the row whose button was pressed.
    await expect(page.getByRole('dialog').getByText('Agenda')).toBeVisible();
  });
});
