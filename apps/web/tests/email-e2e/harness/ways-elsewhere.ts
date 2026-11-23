// What the tests of email reached from outside the mail view share: the
// universal input opened on a request, an inbox whose grant lapsed, an
// account left without an inbox, and what the app asked the authentication
// service when it started a connection.

import { expect, type Page } from '@playwright/test';
import type { Mailbox } from './fixtures';
import { emulatorUrl } from './journeys';

/** The universal input only offers its fields for a text this long. */
export const REQUEST =
  'Tell Bob that lunch on Friday moved to one, same place.';

/** The universal input's own region inside its dialog. */
export function universalInput(page: Page) {
  return page.getByRole('region', { name: 'Create or find something' });
}

/** Opens the universal input from the mail view and types the request. */
export async function openUniversalInput(page: Page): Promise<void> {
  await expect(page.getByText('Inbox').first()).toBeVisible();
  // The shortcut is bound once the app has loaded, a moment after it paints.
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await page.keyboard.type(REQUEST);
}

/** The addresses of the inboxes the signed-in user has connected. */
async function connectedInboxes(mailbox: Mailbox): Promise<string[]> {
  const response = await mailbox.api('/email/email/links');
  const { links } = (await response.json()) as {
    links: { email_address: string }[];
  };
  return links.map((link) => link.email_address);
}

/**
 * Withdraws the inbox's grant at its provider and marks the inbox for
 * reconnecting, as the services do once a token fetch is refused.
 *
 * The mark alone does not hold: a token the provider still grants clears it,
 * and an Outlook inbox's sync fetches tokens just after it is linked. Once the
 * grant is revoked the provider refuses them and the services keep the mark;
 * a token granted just before the revocation can clear it once more, and the
 * sync that asked for it is then refused and marks the inbox again.
 * It is still written here rather than left to the services: on Gmail nothing
 * fetches a token after the first sync, and the links health check a page
 * sends probes an inbox at most once a quarter hour, so after a page has
 * loaded it does not probe again.
 */
export async function lapseGrant(mailbox: Mailbox): Promise<void> {
  const { email, linkId, provider } = mailbox.inbox;
  const revoked = await fetch(
    `${emulatorUrl(mailbox, provider)}/_emulator/mailboxes/${encodeURIComponent(email)}/revoke`,
    { method: 'POST' }
  );
  expect(revoked.ok).toBe(true);
  await mailbox.stack.sql(
    `UPDATE email_links SET needs_reauth = true WHERE id = '${linkId}' RETURNING id`
  );
}

/** Leaves the signed-in user with no inbox connected. */
export async function disconnectInbox(mailbox: Mailbox): Promise<void> {
  const removed = await mailbox.api(
    `/email/email/links/${mailbox.inbox.linkId}`,
    { method: 'DELETE' }
  );
  expect(removed.status).toBe(204);
  await expect.poll(() => connectedInboxes(mailbox)).toEqual([]);
}

/** A connection to Outlook the app asked the authentication service to start. */
export type OutlookStart = {
  scopes: string | null;
  reconnectLinkId: string | null;
};

/**
 * Records the Outlook connections the app starts. The authentication service
 * is not in the stack, so each is refused: the request is what is observed.
 */
export function outlookStarts(mailbox: Mailbox): OutlookStart[] {
  const starts: OutlookStart[] = [];
  mailbox.front.stub(({ method, path, query }) => {
    if (method !== 'POST' || path !== '/auth/link/outlook') return undefined;
    starts.push({
      scopes: query.get('scopes'),
      reconnectLinkId: query.get('reconnect_link_id'),
    });
    return { status: 500, json: { message: 'unavailable' } };
  });
  return starts;
}
