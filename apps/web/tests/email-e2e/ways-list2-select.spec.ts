// Other ways to select rows of the mail list and to clear the selection:
// Cmd/Ctrl+click, Shift+click on a checkbox, Cmd+A, Shift+arrows, Escape,
// the toolbar's Clear, and on a phone a tap while rows are selected. The
// selection lives in the page alone, so the mailbox's provider decides
// nothing: Gmail alone.

import { devices } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { focusedRowId, openThreadId, rowIds } from './harness/list';
import {
  deliverThreads,
  listShows,
  row,
  rowCheckbox,
  selectedIds,
} from './harness/ways-list2';
import { did } from './ledger/record';

const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];

test.describe('other ways to select rows of the mail list, in a Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, one way to select rows selects nothing or the wrong
  // rows (Cmd/Ctrl+click opens the thread, Shift+click takes one row and not
  // the range, Cmd+A or Shift+arrows do nothing), or Escape or the toolbar's
  // Clear leaves rows selected.
  test('each way to select rows selects them, and each way to clear clears', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverThreads(mailbox, [
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
    ]);
    const count = (selected: number) =>
      page.getByText(`${selected} selected`, { exact: true });

    await mailbox.open();
    await listShows(page, Object.values(ids));
    const rows = await rowIds(page);

    // Cmd/Ctrl+click selects the row and does not open it; again unselects.
    await row(page, rows[1]).click({ modifiers: ['ControlOrMeta'] });
    did('AL-403');
    await expect(count(1)).toBeVisible();
    await expect.poll(() => selectedIds(page)).toEqual([rows[1]]);
    expect(openThreadId(page)).toBeUndefined();
    await row(page, rows[3]).click({ modifiers: ['ControlOrMeta'] });
    await expect.poll(() => selectedIds(page)).toEqual([rows[1], rows[3]]);
    await row(page, rows[3]).click({ modifiers: ['ControlOrMeta'] });
    await expect.poll(() => selectedIds(page)).toEqual([rows[1]]);

    // The toolbar's Clear.
    await page
      .getByRole('button', { name: /^Clear(?! filters| selection)/ })
      .click();
    did('AL-407');
    await expect(count(1)).toHaveCount(0);
    await expect.poll(() => selectedIds(page)).toEqual([]);

    // Shift+click on a checkbox takes the rows from the last one chosen.
    await (await rowCheckbox(page, rows[0])).click();
    await expect.poll(() => selectedIds(page)).toEqual([rows[0]]);
    await (await rowCheckbox(page, rows[2])).click({ modifiers: ['Shift'] });
    did('AL-404');
    await expect(count(3)).toBeVisible();
    await expect.poll(() => selectedIds(page)).toEqual(rows.slice(0, 3));

    // Escape clears, and stays on the tab.
    await page.keyboard.press('Escape');
    did('AL-055');
    await expect(count(3)).toHaveCount(0);
    await expect.poll(() => selectedIds(page)).toEqual([]);

    // Cmd+A takes every row, and again none.
    await page.keyboard.press('ControlOrMeta+a');
    did('AL-053');
    await expect(count(4)).toBeVisible();
    await expect.poll(() => selectedIds(page)).toEqual(rows);
    await page.keyboard.press('ControlOrMeta+a');
    await expect(count(4)).toHaveCount(0);
    await expect.poll(() => selectedIds(page)).toEqual([]);

    // Shift+ArrowDown from the first row takes it and the next; Shift+ArrowUp
    // from the last takes it and the one before.
    await page.keyboard.press('Home');
    await expect.poll(() => focusedRowId(page)).toBe(rows[0]);
    await page.keyboard.press('Shift+ArrowDown');
    did('AL-054');
    await expect.poll(() => selectedIds(page)).toEqual(rows.slice(0, 2));
    await page.keyboard.press('Escape');
    await expect.poll(() => selectedIds(page)).toEqual([]);
    await page.keyboard.press('End');
    await expect.poll(() => focusedRowId(page)).toBe(rows[3]);
    await page.keyboard.press('Shift+ArrowUp');
    did('AL-054');
    await expect.poll(() => selectedIds(page)).toEqual(rows.slice(2));
  });
});

test.describe('selecting rows by tap on a phone, in a Gmail inbox', () => {
  test.use({ ...phone, provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a tap on a row while rows are selected opens the thread
  // and does not add the row to the selection (or take it out).
  test('with a row selected, a tap on another row selects it too', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverThreads(mailbox, ['Alpha', 'Bravo', 'Charlie']);
    const count = (selected: number) =>
      page.getByText(`${selected} selected`, { exact: true });

    await mailbox.open();
    await listShows(page, Object.values(ids));
    // The row's checkbox starts the selection.
    await row(page, ids.Alpha)
      .getByRole('checkbox', { name: 'Select item' })
      .tap();
    await expect(count(1)).toBeVisible();

    await row(page, ids.Bravo).tap();
    did('AL-405');
    await expect(count(2)).toBeVisible();
    expect(openThreadId(page)).toBeUndefined();
    await row(page, ids.Bravo).tap();
    await expect(count(1)).toBeVisible();
    expect(openThreadId(page)).toBeUndefined();
  });
});
