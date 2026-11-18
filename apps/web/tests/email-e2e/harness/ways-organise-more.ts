// More of what the tests of a thread's actions share: the selection toolbar,
// the Share dialog, the folder picker, the Remind me menu and the clipboard.

import type { Locator, Page } from '@playwright/test';
import { expect, type Mailbox } from './fixtures';
import { followup } from './organise';
import { held } from './ways-organise';

/** A button of the selection toolbar: the rows have one of the same name. */
export function toolbarButton(page: Page, name: string | RegExp): Locator {
  return page
    .getByRole('button', { name, exact: typeof name === 'string' })
    .and(page.locator(':not([data-entity-id] *)'));
}

/** The toolbar's Clear: its name ends in the key that does the same. */
export const CLEAR = /^Clear(?! selection)/;

/** The Share dialog of a thread. */
export function shareDialog(page: Page, subject: string): Locator {
  return page.getByRole('dialog', { name: `Share: ${subject}` });
}

/** Waits for the Share dialog to list the person the thread is shared with. */
export async function expectShareDialog(
  page: Page,
  subject: string,
  person: string
): Promise<void> {
  const dialog = shareDialog(page, subject);
  await expect(
    dialog.getByText('People with access to this email thread')
  ).toBeVisible();
  await expect(dialog.getByText(person)).toBeVisible();
}

/** Whether the provider holds the message with this subject as read. */
export function readAt(mailbox: Mailbox, subject: string) {
  return async () => (await held(mailbox, subject))?.read;
}

/** Whether the provider holds the message with this subject in the inbox. */
export function inInboxAt(mailbox: Mailbox, subject: string) {
  return async () => (await held(mailbox, subject))?.inInbox;
}

/** The name of the folder the storage service holds, by id. */
export async function folderName(
  mailbox: Mailbox,
  folderId: string | undefined
): Promise<string | undefined> {
  if (!folderId) return undefined;
  const response = await mailbox.api('/dss/projects');
  const body = (await response.json()) as {
    data: { id: string; name: string }[];
  };
  return body.data.find(({ id }) => id === folderId)?.name;
}

/** Picks a folder (or names a new one) in the open Move to folder picker. */
export async function pickFolder(
  page: Page,
  typed: string,
  option: RegExp
): Promise<void> {
  const search = page.getByRole('combobox', {
    name: 'Search folders or name a new one…',
  });
  await search.fill(typed);
  await page.getByRole('option', { name: option }).click();
  await expect(search).toHaveCount(0);
}

/** The Remind me menu's time field. */
export function remindWhen(page: Page): Locator {
  return page.getByRole('combobox', { name: 'Remind me when' });
}

/** Picks "tomorrow 9am" in the open Remind me menu, which saves it. */
export async function remindTomorrow(page: Page): Promise<void> {
  const when = remindWhen(page);
  const tomorrow = page.getByRole('option', { name: /^tomorrow 9am/ });
  await when.fill('tomorrow 9am');
  await expect(tomorrow).toBeVisible();
  // Until the menu has read the thread's reminder its times are disabled,
  // and Enter on one does nothing.
  await expect(tomorrow).toBeEnabled();
  await when.press('Enter');
  await expect(when).toHaveCount(0);
}

/** Waits for the storage service to hold a pending reminder for the thread. */
export async function expectReminder(
  mailbox: Mailbox,
  threadId: string
): Promise<void> {
  await expect
    .poll(() => followup(mailbox, threadId))
    .toMatchObject({ state: 'pending', condition: 'if_no_reply' });
}

/** What the clipboard holds, once it holds what is expected. */
export async function expectClipboard(
  page: Page,
  expected: string | RegExp
): Promise<void> {
  // A string is the whole clipboard: what an earlier copy left there may
  // contain it.
  const read = expect.poll(() =>
    page.evaluate(() => navigator.clipboard.readText())
  );
  if (typeof expected === 'string') await read.toBe(expected);
  else await read.toMatch(expected);
}

/** A string matched as itself in a regular expression. */
export function literally(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
