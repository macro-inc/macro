import type {
  APIRequestContext,
  APIResponse,
  Locator,
  Page,
} from '@playwright/test';
import { expect } from '@playwright/test';
import { conversations } from './channel';
import { apiFor, type PersonKey } from './people';

type Call = (http: APIRequestContext) => Promise<APIResponse>;

/**
 * The list of conversations beside the open one: which rows it has, under
 * which heading, and what each row says about unread messages.
 */

/** A conversation's row, by the channel it opens. Favorites are not these. */
export function rowOf(page: Page, channelId: string): Locator {
  return conversations(page)
    .locator(`[data-key="channel:${channelId}"]`)
    .getByRole('treeitem');
}

/** The dot a row carries while the conversation has unread messages. */
export function unreadDot(row: Locator): Locator {
  return row.getByLabel('Unread', { exact: true });
}

/** The count a row carries while the person is mentioned in unread messages. */
export function mentionCount(row: Locator): Locator {
  return row.getByLabel(/^\d+\+? unread mentions?$/);
}

/** The crossed bell a row carries while its notifications are muted. */
export function mutedBell(row: Locator): Locator {
  return row.getByLabel('Notifications muted', { exact: true });
}

export type Section =
  | 'favorites'
  | 'direct_messages'
  | 'team_channels'
  | 'channels';

/** One heading of the list with the rows under it. */
export function section(page: Page, name: Section): Locator {
  return conversations(page).locator(`[data-key="${name}"]`);
}

/** The id of the conversation on screen, from the page's address. */
export function openConversationId(page: Page): string {
  const id = /\/channels?\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!id) throw new Error(`no conversation is open at ${page.url()}`);
  return id;
}

/** "New" → "New direct message": the page a conversation is started from. */
export async function startDirectMessage(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: 'Create channel or direct message' })
    .click();
  await page.getByRole('menuitem', { name: 'New direct message' }).click();
}

/** The box of the new-message page that takes the people to write to. */
export function recipients(page: Page): Locator {
  return page
    .getByRole('combobox', { name: /^To:/ })
    .or(page.getByRole('group').getByRole('combobox'));
}

/**
 * Adds a person to the new message by their whole email address, which the
 * box accepts as it stands.
 */
export async function addRecipient(page: Page, email: string): Promise<void> {
  await recipients(page).first().click();
  await page.keyboard.type(email);
  await page.getByRole('option', { name: email }).click();
}

/** The box of the new-message page the first message is written in. */
export function firstMessageBox(page: Page): Locator {
  return page.getByRole('textbox', { name: /^Send message/ });
}

async function asked(key: PersonKey, what: string, call: Call): Promise<void> {
  const http = await apiFor(key);
  const response = await call(http);
  const failed = response.ok()
    ? undefined
    : `${what} failed (${response.status()}): ${await response.text()}`;
  await http.dispose();
  if (failed) throw new Error(failed);
}

/**
 * The person has looked at the channel, as from another device. A page
 * records a look some moments after the person leaves the channel, with
 * nothing on screen to wait for, so tests that need "read up to here" say so
 * through the service, before the person's page loads.
 */
export async function haveViewed(
  key: PersonKey,
  channelId: string
): Promise<void> {
  await asked(key, 'view channel', (http) =>
    http.post('/dss/channels/activity', {
      data: { activity_type: 'view', channel_id: channelId },
    })
  );
}

/** Renames a channel; the service answers in plain text, not JSON. */
export async function renameChannel(
  key: PersonKey,
  channelId: string,
  name: string
): Promise<void> {
  await asked(key, 'rename channel', (http) =>
    http.patch(`/dss/channels/${channelId}`, { data: { channel_name: name } })
  );
}

/**
 * Chooses from a row's menu, opened with the right mouse button; every
 * item but the last opens a submenu.
 */
export async function chooseFromRowMenu(
  page: Page,
  row: Locator,
  ...items: string[]
): Promise<void> {
  const menu = page.getByRole('menu');
  // The menu is drawn again whenever its row changes, which closes a submenu
  // that was opening and takes the items away; a person starts again, and so
  // does this. Keys, not the pointer: a submenu opens on hover after a delay
  // and closes when the pointer crosses another item on its way in.
  await expect(async () => {
    if ((await menu.count()) === 0) await row.click({ button: 'right' });
    for (const name of items.slice(0, -1)) {
      const item = page.getByRole('menuitem', { name });
      await item.press('ArrowRight', { timeout: 2000 });
      await expect(item).toHaveAttribute('aria-expanded', 'true', {
        timeout: 2000,
      });
    }
    await page
      .getByRole('menuitem', { name: items[items.length - 1] })
      .press('Enter', { timeout: 2000 });
  }).toPass();
}

/**
 * Types into "Search conversations", which narrows the list to the
 * conversations whose name has the text. The list draws only the rows near
 * its window and every test adds rows to it, so this is how a test, like a
 * person with many channels, gets the rows it means on screen. A reload
 * empties the box.
 */
export async function findConversations(
  page: Page,
  text: string
): Promise<void> {
  const box = page.getByRole('searchbox', { name: 'Search conversations' });
  const opener = page.getByRole('button', { name: 'Search conversations' });
  await expect(box.or(opener).first()).toBeVisible();
  if (!(await box.isVisible())) await opener.click();
  await box.fill(text);
}
