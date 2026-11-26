// Shared steps of the `ways-list2-*` specs: the other ways into the list's
// functions (shortcuts, row buttons, the selection toolbar, phone gestures).

import { expect, type Locator, type Page } from '@playwright/test';
import type { Mailbox } from './fixtures';
import { rowIds } from './list';
import type { ProviderMessage } from './stack';

const FROM = 'Grace <grace@example.com>';

/** The row of a thread in the list. */
export function row(page: Page, threadId: string): Locator {
  return page.locator(`[data-soup-entity] [data-entity-id="${threadId}"]`);
}

/** The provider's copy of the message with this subject. */
export async function held(
  mailbox: Mailbox,
  subject: string
): Promise<ProviderMessage | undefined> {
  return (await mailbox.providerMessages()).find(
    (message) => message.subject === subject
  );
}

/**
 * Delivers one thread per subject, in order, and answers the thread id Macro
 * gave each once it has synced them all.
 */
export async function deliverThreads(
  mailbox: Mailbox,
  subjects: readonly string[]
): Promise<Record<string, string>> {
  for (const subject of subjects) {
    await mailbox.deliver({
      from: FROM,
      subject,
      text: `About ${subject}.`,
    });
  }
  const ids: Record<string, string> = {};
  for (const subject of subjects) {
    ids[subject] = (await mailbox.synced(subject)).id;
  }
  return ids;
}

/** Waits until the list shows exactly these threads, in any order. */
export async function listShows(page: Page, ids: string[]): Promise<void> {
  await expect
    .poll(async () => (await rowIds(page)).sort())
    .toEqual([...ids].sort());
}

/** The checkbox that selects a row; it shows once the row is hovered. */
export async function rowCheckbox(
  page: Page,
  threadId: string
): Promise<Locator> {
  await row(page, threadId).hover();
  return row(page, threadId).getByRole('checkbox', { name: 'Select item' });
}

/** The ids of the rows that are selected, top to bottom. */
export async function selectedIds(page: Page): Promise<string[]> {
  const selected: string[] = [];
  for (const id of await rowIds(page)) {
    const checked = await row(page, id)
      .getByRole('checkbox', { name: 'Select item' })
      .isChecked({ timeout: 2_000 })
      .catch(() => false);
    if (checked) selected.push(id);
  }
  return selected;
}

/** The tab the list is on, from the page's address; Signal has none. */
export function tabInAddress(page: Page): string | undefined {
  return /[?&](?:mail\.)?tab=([a-z-]+)/.exec(page.url())?.[1];
}

/**
 * Drags a finger across a row of the list, `distance` pixels to the right
 * (to the left when negative), starting away from the screen's edges.
 */
export async function swipeRow(
  page: Page,
  threadId: string,
  distance: number
): Promise<void> {
  const surface = page.locator(
    `[data-swipe-id="${threadId}"] [data-swipe-surface]`
  );
  // The touches go to fixed points: wait until the row stops moving.
  let box = await surface.boundingBox();
  await expect
    .poll(async () => {
      const next = await surface.boundingBox();
      const still =
        next !== null && box !== null && next.x === box.x && next.y === box.y;
      box = next;
      return still;
    })
    .toBe(true);
  if (!box) throw new Error(`no row for ${threadId}`);
  const y = box.y + box.height / 2;
  const start = distance > 0 ? box.x + 80 : box.x + box.width - 60;
  const direction = Math.sign(distance);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: start, y }],
  });
  for (let moved = 10; moved <= Math.abs(distance); moved += 30) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start + direction * moved, y }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await cdp.detach();
}

/**
 * Holds a finger on a row until `shown` appears (the app answers a long
 * press), then lifts it.
 */
export async function longPressRow(
  page: Page,
  threadId: string,
  shown: Locator
): Promise<void> {
  const box = await row(page, threadId).boundingBox();
  if (!box) throw new Error(`no row for ${threadId}`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  });
  await expect(shown).toBeVisible();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await cdp.detach();
}
