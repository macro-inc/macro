// Other ways to use the reading pane: Shift+V shows and hides it, the
// divider between list and thread drags, and Enter or a click on the row the
// pane already shows hands the keyboard to the thread. The pane is the page's
// own, so the mailbox's provider decides nothing: Gmail alone.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { focusedRowId, openThreadId, rowIds } from './harness/list';
import { deliverThreads, listShows, row } from './harness/ways-list2';
import { did } from './ledger/record';

/** Whether the keyboard's focus is inside the reading pane. */
function focusInPane(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.activeElement?.closest(
        '[role="region"][aria-label="Reading pane"]'
      ) !== null && document.activeElement !== null
  );
}

/** The list's width the app keeps for the reading pane, as it stored it. */
function storedListWidth(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) =>
      name.includes('reading-pane-list-width')
    );
    return key ? (localStorage.getItem(key) ?? undefined) : undefined;
  });
}

test.describe('other ways to use the reading pane, in a Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, Shift+V does not show or hide the pane, the divider
  // does not move the list's edge (or the width is not kept), or Enter and a
  // click on the row the pane shows leave the keyboard with the list.
  test('Shift+V toggles the pane, the divider resizes it, and the shown row hands over the keyboard', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverThreads(mailbox, ['Alpha', 'Bravo']);
    const list = page.getByRole('grid', { name: 'Email' });
    const pane = page.getByRole('region', { name: 'Reading pane' });

    await page.setViewportSize({ width: 1600, height: 900 });
    await mailbox.open();
    await listShows(page, Object.values(ids));
    const rows = await rowIds(page);
    await expect(
      page.getByRole('button', { name: 'Show reading pane' })
    ).toBeVisible();

    await page.keyboard.press('Shift+V');
    did('AL-036');
    await expect(
      page.getByRole('button', { name: 'Hide reading pane' })
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(pane).toBeVisible();

    // The pane follows the cursor; the keyboard stays with the list.
    await page.keyboard.press('j');
    await expect.poll(() => openThreadId(page)).toBe(rows[1]);
    await expect(pane.getByText('About', { exact: false })).toBeVisible();
    await expect(row(page, rows[1])).toHaveAttribute('aria-current', 'true');
    expect(await focusInPane(page)).toBe(false);

    // The divider: the list grows by about what it was dragged.
    const before = (await list.boundingBox())?.width ?? 0;
    const divider = page
      .getByRole('separator')
      .filter({ hasNotText: /./ })
      .last();
    const handle = await divider.boundingBox();
    if (!handle) throw new Error('no divider between list and thread');
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y, { steps: 6 });
    await page.mouse.move(x + 120, y, { steps: 6 });
    await page.mouse.up();
    did('AL-037');
    await expect
      .poll(async () => ((await list.boundingBox())?.width ?? 0) - before)
      .toBeGreaterThan(90);
    const after = Math.round((await list.boundingBox())?.width ?? 0);
    await expect
      .poll(async () => Number(await storedListWidth(page)))
      .toBeCloseTo(after, -1);

    // Enter on the row the pane shows: the thread takes the keyboard.
    await expect.poll(() => focusedRowId(page)).toBe(rows[1]);
    await page.keyboard.press('Enter');
    did('AL-413');
    await expect.poll(() => focusInPane(page)).toBe(true);
    expect(openThreadId(page)).toBe(rows[1]);

    // A click on that row does the same, from the list again.
    await list.focus();
    await expect.poll(() => focusInPane(page)).toBe(false);
    await row(page, rows[1]).click();
    did('AL-413');
    await expect.poll(() => focusInPane(page)).toBe(true);

    // Shift+V again hides the pane: the open thread then takes the list's
    // place (email-view.tsx), and Back leads to the list without the pane.
    await list.focus();
    await page.keyboard.press('Shift+V');
    did('AL-036');
    await expect(pane).toHaveCount(0);
    await expect(list).toHaveCount(0);
    expect(openThreadId(page)).toBe(rows[1]);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(
      page.getByRole('button', { name: 'Show reading pane' })
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(pane).toHaveCount(0);
    await listShows(page, Object.values(ids));
  });
});
