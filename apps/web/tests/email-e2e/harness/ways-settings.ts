// Helpers of the `ways-settings-*` specs: what the email service holds for
// the signed-in user's inboxes, and the states those specs start from.

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Locator, Page } from '@playwright/test';
import { expect, type Mailbox } from './fixtures';

export const SETTINGS = '/app/mail/~/settings/email';

export type Link = {
  id: string;
  email_address: string;
  provider: string;
  is_primary: boolean;
  needs_reauth: boolean;
  needs_calendar_permission: boolean;
  calendar_disabled: boolean;
  settings?: { signature?: string | null };
};

/** The inboxes of the signed-in user as the email service answers them. */
export async function links(mailbox: Mailbox): Promise<Link[]> {
  const response = await mailbox.api('/email/email/links');
  const body = (await response.json()) as { links: Link[] };
  return body.links.sort((a, b) =>
    a.email_address.localeCompare(b.email_address)
  );
}

export async function connectedInboxes(mailbox: Mailbox): Promise<string[]> {
  return (await links(mailbox)).map((link) => link.email_address);
}

/** The signature the email service holds for the test's inbox ('' for none). */
export async function storedSignature(mailbox: Mailbox): Promise<string> {
  const own = (await links(mailbox)).find(
    (link) => link.email_address === mailbox.inbox.email
  );
  return own?.settings?.signature ?? '';
}

const MAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

/**
 * Leaves a Gmail inbox holding the calendar permission, as after its owner
 * granted it at Google. An Outlook inbox is connected with it.
 */
export async function grantCalendar(mailbox: Mailbox): Promise<void> {
  const scopes = [MAIL_SCOPE, ...CALENDAR_SCOPES]
    .map((scope) => `'${scope}'`)
    .join(',');
  await mailbox.stack.sql(
    `INSERT INTO email_link_google_scopes (link_id, granted_scopes)
     VALUES ('${mailbox.inbox.linkId}', ARRAY[${scopes}]::text[])
     ON CONFLICT (link_id) DO UPDATE SET granted_scopes = EXCLUDED.granted_scopes
     RETURNING link_id`
  );
}

/** Makes the signed-in user someone whose first-run tutorial is not done. */
export function becomeFirstRun(mailbox: Mailbox): void {
  mailbox.front.stub(({ path }) => {
    if (path !== '/auth/user/legacy_user_permissions') return undefined;
    return {
      json: {
        userId: mailbox.user.macroUserId,
        email: mailbox.user.email,
        name: mailbox.user.email.split('@')[0],
        permissions: [],
        licenseStatus: 'active',
        tutorialComplete: false,
        group: null,
        hasChromeExt: false,
        hasTrialed: true,
        aiDataConsent: true,
        referralCode: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
    };
  });
}

/** Removes the inbox the test started with. */
export async function removeInbox(mailbox: Mailbox): Promise<void> {
  const removed = await mailbox.api(
    `/email/email/links/${mailbox.inbox.linkId}`,
    { method: 'DELETE' }
  );
  expect(removed.status).toBe(204);
  await expect
    .poll(() => connectedInboxes(mailbox))
    .not.toContain(mailbox.inbox.email);
}

/** The tabs of an inbox's signature: Preview, Rich text, HTML. */
export function signatureTabs(page: Page, address: string): Locator {
  return page.getByRole('tablist', { name: `Signature views for ${address}` });
}

/** The rich-text editor of an inbox's signature. */
export function richText(page: Page, address: string): Locator {
  return page.getByRole('textbox', { name: `Signature for ${address}` });
}

/**
 * Pastes into whatever holds the focus, as Ctrl+V does: the clipboard is
 * filled through the browser's own API, then the key is pressed. The context
 * needs the clipboard permissions.
 */
export async function pasteFromClipboard(
  page: Page,
  content: { text: string; html?: string }
): Promise<void> {
  await page.evaluate(async ({ text, html }) => {
    const item: Record<string, Blob> = {
      'text/plain': new Blob([text], { type: 'text/plain' }),
    };
    if (html) item['text/html'] = new Blob([html], { type: 'text/html' });
    await navigator.clipboard.write([new ClipboardItem(item)]);
  }, content);
  await page.keyboard.press('ControlOrMeta+v');
}

/**
 * Opens the Rich text view of an inbox's signature. The tab can ignore a
 * click made while the section is still settling, so it is pressed until it
 * is the selected one.
 */
export async function openRichText(page: Page, address: string): Promise<void> {
  const tab = signatureTabs(page, address).getByRole('tab', {
    name: 'Rich text',
  });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true', {
      timeout: 2_000,
    });
  }).toPass();
  await expect(richText(page, address)).toBeVisible();
}

/** Saves the signature as it stands in Settings and waits for the notice. */
export async function saveSignature(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save signature' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Signature saved' }).first()
  ).toBeVisible();
}

/** A control of the rich-text toolbar that opens a list of choices. */
export function picker(page: Page, name: string): Locator {
  return page.locator(`.ql-picker[aria-label="${name}"]`);
}

/** Chooses `value` in one of the toolbar's lists (Font, Font size, colors). */
export async function pick(
  page: Page,
  name: string,
  value: string
): Promise<void> {
  await picker(page, name).getByRole('button').first().click();
  await picker(page, name)
    .locator(`.ql-picker-item[data-value="${value}"]`)
    .click();
}

// A one-pixel PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Serves a picture at an address both the browser and the email service can
 * read: the service fetches a signature's pictures before it saves it.
 */
export async function servePicture(): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'image/png',
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
    });
    response.end(PNG);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/logo.png`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
