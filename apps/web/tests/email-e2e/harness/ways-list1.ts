// What the tests of the other ways into the mail list's functions share
// (`ways-list1-*.spec.ts`): the list's rows, its header controls, the filter
// menu, the phone's filter drawer, and on touch the Email sidebar's sheet and
// the header's name for the open tab.

import {
  devices,
  expect,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test';
import { did } from '../ledger/record';
import type { Mailbox } from './fixtures';
import { rowIds } from './list';

const { defaultBrowserType: _browser, ...iPhone } = devices['iPhone 13'];

/** The phone the suite's phone tests run on. */
export const PHONE = iPhone;

/** The Email sidebar as a touch device shows it: a sheet. */
export function sidebarSheet(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Sidebar' });
}

/** Opens the Email sidebar's sheet with the touch header's pill. */
export async function openSidebarSheet(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Show sidebar' }).tap();
  did('AL-911');
  const sheet = sidebarSheet(page);
  await expect(
    sheet.getByRole('navigation', { name: 'Email tabs' })
  ).toBeVisible();
  return sheet;
}

/**
 * Opens a tab on a touch device. Its header has pills for the Inbox tabs
 * only; every tab is in the sidebar's sheet, which closes on the choice.
 */
export async function openTouchTab(page: Page, name: string): Promise<void> {
  const sheet = await openSidebarSheet(page);
  await sheet
    .getByRole('navigation', { name: 'Email tabs' })
    .getByRole('button', { name, exact: true })
    .tap();
  await expect(sheet).toHaveCount(0);
}

/**
 * The name the touch list header shows in place of the Inbox pills: the
 * tab's, outside the Inbox.
 */
export function touchHeaderName(page: Page, name: string): Locator {
  return page
    .locator('[data-mobile-list-header]')
    .getByText(name, { exact: true });
}

export const GRACE = 'Grace <grace@example.com>';
export const HUGO = 'Hugo <hugo@example.com>';

/** The row of a thread in the list. */
export function row(page: Page, threadId: string): Locator {
  return page.locator(`[data-soup-entity] [data-entity-id="${threadId}"]`);
}

/** Waits until the list shows exactly these threads, in any order. */
export async function expectRows(page: Page, ids: string[]): Promise<void> {
  await expect
    .poll(async () => (await rowIds(page)).toSorted())
    .toEqual(ids.toSorted());
}

/**
 * Whether a request of the browser is the list asking the storage service
 * for its threads, with `filter` in what it asks for.
 */
export function listQuery(request: Request, filter: string): boolean {
  if (request.method() !== 'POST') return false;
  if (!new URL(request.url()).pathname.endsWith('/graphql')) return false;
  const body = request.postData() ?? '';
  return body.includes('"operationName":"Soup"') && body.includes(filter);
}

/** Delivers one message per subject and answers the thread id of each. */
export async function deliverAll(
  mailbox: Mailbox,
  subjects: string[],
  from = GRACE
): Promise<Record<string, string>> {
  for (const subject of subjects) {
    await mailbox.deliver({ from, subject, text: `Body of ${subject}.` });
  }
  const ids: Record<string, string> = {};
  for (const subject of subjects) {
    ids[subject] = (await mailbox.synced(subject)).id;
  }
  return ids;
}

/** The group of filter controls in the list header. */
export function filterGroup(page: Page): Locator {
  return page.getByRole('group', { name: 'Email filters' });
}

/** The filter menu, once open. */
export function filterMenu(page: Page): Locator {
  return page.getByRole('menu', { name: 'Filter email', exact: true });
}

/** Opens the filter menu with its header button, unless it is open. */
export async function openFilterMenu(page: Page): Promise<void> {
  const menu = filterMenu(page);
  if (await menu.isVisible()) return;
  await filterGroup(page).getByRole('button', { name: 'Filter email' }).click();
  await expect(menu).toBeVisible();
}

/** Closes every open menu. */
export async function closeMenus(page: Page): Promise<void> {
  await expect(async () => {
    if ((await page.getByRole('menu').count()) > 0)
      await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 1_000 });
  }).toPass();
}

/** Opens a group of the filter menu: its submenu. */
export async function openFilterGroup(
  page: Page,
  group: string
): Promise<void> {
  await openFilterMenu(page);
  await filterMenu(page)
    .getByRole('menuitem', { name: group, exact: true })
    .click();
  await expect(
    page.getByRole('menu', { name: group, exact: true })
  ).toBeVisible();
}

/** Resets the filters with the filter menu's own "Clear filters". */
export async function clearFilters(page: Page): Promise<void> {
  await closeMenus(page);
  await openFilterMenu(page);
  await filterMenu(page)
    .getByRole('menuitem', { name: 'Clear filters' })
    .click();
  await closeMenus(page);
}

/** Asks the storage service's GraphQL as the signed-in user. */
export async function graphql<T>(
  mailbox: Mailbox,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const response = await mailbox.api('/dss/items/soup/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as { data?: T; errors?: unknown };
  if (!body.data || body.errors) {
    throw new Error(`GraphQL failed: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

/** The filter menu's header button. */
export function filterButton(page: Page): Locator {
  return filterGroup(page).getByRole('button', { name: 'Filter email' });
}

/** One of the filter menu's submenus, once open. */
export function filterSubmenu(page: Page, group: string): Locator {
  return page.getByRole('menu', { name: group, exact: true });
}

/**
 * Chooses one item of a group of the filter menu, from a closed menu: the
 * header button, the group's entry, the item.
 */
export async function pickFilter(
  page: Page,
  group: string,
  role: 'menuitemradio' | 'menuitemcheckbox',
  name: string
): Promise<void> {
  await closeMenus(page);
  await openFilterGroup(page, group);
  await filterSubmenu(page, group)
    .getByRole(role, { name, exact: true })
    .click();
}

/** A one-page PDF and a one-pixel PNG, as attachments. */
export const PDF_FILE = {
  filename: 'report.pdf',
  mimeType: 'application/pdf',
  base64: Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
  ).toString('base64'),
};
export const PNG_FILE = {
  filename: 'photo.png',
  mimeType: 'image/png',
  base64:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
};

const INVITATION = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Example//Calendar//EN',
  'VERSION:2.0',
  'CALSCALE:GREGORIAN',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'DTSTART:20270114T170000Z',
  'DTEND:20270114T180000Z',
  'DTSTAMP:20261112T120000Z',
  'ORGANIZER;CN=Grace:mailto:grace@example.com',
  'UID:ways-list1-review@example.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Ada:mailto:ada@example.com',
  'SEQUENCE:0',
  'STATUS:CONFIRMED',
  'SUMMARY:Planning review',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

/**
 * Delivers an invitation the way each provider carries one: Gmail as an
 * `.ics` attachment, Outlook as an event message holding the calendar.
 */
export async function deliverInvitation(
  mailbox: Mailbox,
  subject: string
): Promise<void> {
  const mail = { from: GRACE, subject, text: 'You have been invited.' };
  if (mailbox.inbox.provider === 'GMAIL') {
    await mailbox.deliver({
      ...mail,
      attachments: [
        {
          filename: 'invite.ics',
          mimeType: 'text/calendar; method=REQUEST; charset=UTF-8',
          base64: Buffer.from(INVITATION).toString('base64'),
        },
      ],
    });
    return;
  }
  const response = await fetch(
    `${mailbox.stack.info.outlookUrl}/_emulator/mailboxes/${encodeURIComponent(mailbox.inbox.email)}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...mail, calendar: INVITATION }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Outlook refused the invitation: ${response.status} ${await response.text()}`
    );
  }
}

/** The user's saved views as the storage service holds them: name, filters. */
export async function storedViews(
  mailbox: Mailbox
): Promise<{ name: string; filters: Record<string, unknown> }[]> {
  const data = await graphql<{
    user: {
      savedViews: {
        nodes: { name: string; config: { filters: Record<string, unknown> } }[];
      };
    };
  }>(
    mailbox,
    'query { user { id savedViews(first: 20) { nodes { name config } } } }'
  );
  return data.user.savedViews.nodes.map((view) => ({
    name: view.name,
    filters: view.config.filters,
  }));
}
