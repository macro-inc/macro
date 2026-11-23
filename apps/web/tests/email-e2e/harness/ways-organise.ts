// The ways into a thread's actions besides the shortcut and the row button:
// the row's context menu, the command menu, the open thread's header and the
// menu after its subject. What the tests of those ways share.

import type { Locator, Page } from '@playwright/test';
import { expect, type Mailbox } from './fixtures';
import { openThreadId, rowIds } from './list';
import type { ProviderMessage } from './stack';

/** The row of a thread in the list. */
export function row(page: Page, threadId: string): Locator {
  return page.locator(`[data-soup-entity] [data-entity-id="${threadId}"]`);
}

/** Delivers one message per subject and answers the threads' ids by subject. */
export async function deliverAll(
  mailbox: Mailbox,
  subjects: readonly string[],
  from = 'Grace <grace@example.com>'
): Promise<Record<string, string>> {
  for (const subject of subjects) {
    await mailbox.deliver({ from, subject, text: `About ${subject}.` });
  }
  const ids: Record<string, string> = {};
  for (const subject of subjects) {
    ids[subject] = (await mailbox.synced(subject)).id;
  }
  return ids;
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

/** The threads the storage service holds as the user's favorites. */
export async function favorites(mailbox: Mailbox): Promise<string[]> {
  const response = await mailbox.api('/dss/favorites');
  const body = (await response.json()) as {
    favorites: { entityType: string; entityId: string }[];
  };
  return body.favorites
    .filter(({ entityType }) => entityType === 'email_thread')
    .map(({ entityId }) => entityId);
}

/** The senders the email service answers as blocked in the inbox. */
export async function blocked(mailbox: Mailbox): Promise<string[]> {
  const response = await mailbox.api('/email/email/contacts/blocked');
  return ((await response.json()) as { blocked_emails: string[] })
    .blocked_emails;
}

/** The inbox's sender filters: the address and whether it is Signal. */
export async function senderFilters(
  mailbox: Mailbox
): Promise<{ address: string | null; signal: boolean }[]> {
  const response = await mailbox.api('/email/email/filters');
  const body = (await response.json()) as {
    filters: { email_address: string | null; is_important: boolean }[];
  };
  return body.filters.map((filter) => ({
    address: filter.email_address,
    signal: filter.is_important,
  }));
}

/** The folder (project) the email service holds a thread in. */
export async function folderOf(
  mailbox: Mailbox,
  threadId: string
): Promise<string | undefined> {
  const response = await mailbox.api(
    `/email/email/threads/${threadId}?limit=1`
  );
  const body = (await response.json()) as {
    thread?: { project_id?: string | null };
  };
  return body.thread?.project_id ?? undefined;
}

/** What the clipboard holds. */
export function clipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Picks an item of a row's context menu. */
export async function rowMenu(
  page: Page,
  threadId: string,
  item: string | RegExp
): Promise<void> {
  await row(page, threadId).click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: item }).click();
}

/** Opens a thread from its row and waits for its text. */
export async function openFromList(
  page: Page,
  threadId: string,
  text: string,
  within: Page | Locator = page
): Promise<void> {
  await row(page, threadId).click();
  await expect.poll(() => openThreadId(page)).toBe(threadId);
  await expect(within.getByText(text)).toBeVisible();
}

/**
 * Leaves the open thread for the list it was opened from, with Escape as a
 * user does: a reload could cut off a request still on its way.
 */
export async function backToList(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      if (openThreadId(page)) await page.keyboard.press('Escape');
      return openThreadId(page);
    })
    .toBeUndefined();
}

/** The button that opens the menu after an open thread's subject. */
export function titleMenuButton(page: Page, subject: string): Locator {
  return page
    .getByRole('heading', { name: subject, level: 1 })
    .getByRole('button');
}

/** Picks an item of the menu after an open thread's subject. */
export async function titleMenu(
  page: Page,
  subject: string,
  item: string | RegExp
): Promise<void> {
  await titleMenuButton(page, subject).click();
  await page.getByRole('menu').getByRole('menuitem', { name: item }).click();
}

/** Ticks the rows of these threads, and waits for the toolbar's count. */
export async function selectRows(
  page: Page,
  threadIds: readonly string[]
): Promise<void> {
  await expect
    .poll(() => rowIds(page))
    .toEqual(expect.arrayContaining([...threadIds]));
  for (const id of threadIds) {
    await row(page, id).hover();
    await row(page, id).getByRole('checkbox', { name: 'Select item' }).click();
  }
  await expect(
    page.getByText(`${threadIds.length} selected`, { exact: true })
  ).toBeVisible();
}

/** Runs an action of the command menu that is open for a row or a selection. */
export async function commandAction(
  page: Page,
  typed: string,
  option: RegExp
): Promise<void> {
  const search = page.getByRole('textbox', { name: 'Search actions...' });
  await search.fill(typed);
  await page
    .getByRole('listbox', { name: 'Search results' })
    .getByRole('option', { name: option })
    .click();
  await expect(search).toHaveCount(0);
}

/** Holds a finger on a row of the phone's list until `shown` is visible. */
export async function longPress(
  page: Page,
  threadId: string,
  shown: Locator
): Promise<void> {
  const surface = page.locator(`[data-swipe-id="${threadId}"]`);
  // The touch goes to a fixed point: wait until the row stops moving.
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
