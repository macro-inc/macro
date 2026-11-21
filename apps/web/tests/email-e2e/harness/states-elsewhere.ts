// What the tests of the states email shows outside the mail view share: the
// universal input set to Email, the inbox's calendar left in each state the
// calendar's setup status names, and a draft held on this device.

import type { Page, Route } from '@playwright/test';
import { graphqlOperation } from './drafts';
import type { Mailbox } from './fixtures';
import { universalInput } from './ways-elsewhere';

/** Chooses Email as the universal input's content type. */
export async function chooseEmail(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Content type' }).click();
  await page.getByRole('option', { name: 'Email' }).click();
}

/** Adds a recipient to the universal input's To field. */
export async function addRecipient(page: Page, address: string): Promise<void> {
  const to = universalInput(page).getByRole('combobox', { name: 'To' });
  await to.fill(address);
  await to.press('Enter');
}

/** Pastes a link at the end of the universal input's request. */
export async function pasteIntoRequest(
  page: Page,
  link: string
): Promise<void> {
  await page.evaluate((text) => navigator.clipboard.writeText(text), link);
  await universalInput(page)
    .getByRole('textbox', { name: 'Your input' })
    .click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' ');
  await page.keyboard.press('ControlOrMeta+v');
}

/** Leaves the inbox's calendar turned off by its owner. */
export async function turnCalendarOff(mailbox: Mailbox): Promise<void> {
  await mailbox.stack.sql(
    `INSERT INTO email_link_google_scopes (link_id, calendar_disabled_at)
     VALUES ('${mailbox.inbox.linkId}', now())
     ON CONFLICT (link_id) DO UPDATE SET calendar_disabled_at = now()
     RETURNING link_id`
  );
}

/** The calendar's grid, which the setup status lies over. */
export function calendarPeriods(page: Page) {
  return page.getByRole('region', { name: 'Calendar periods' });
}

/**
 * Holds every draft save the page sends, so what the composer wrote stays on
 * this device. `saves` counts the held saves.
 */
export async function holdDraftSaves(page: Page): Promise<{ saves: Route[] }> {
  const saves: Route[] = [];
  await page.route('**/graphql', async (route) => {
    if (graphqlOperation(route.request()) !== 'SaveEmailDraft')
      return route.fallback();
    saves.push(route);
  });
  return { saves };
}

/** Opens the phone's search from the dock. */
export async function openPhoneSearch(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}

/** The field of the phone's search. */
export function phoneSearchField(page: Page) {
  return page.getByRole('textbox', { name: 'Search or create' });
}

/** The rows the phone's search lists for what was typed. */
export function phoneSearchResults(page: Page) {
  return page.getByRole('region', { name: 'Search results' });
}
