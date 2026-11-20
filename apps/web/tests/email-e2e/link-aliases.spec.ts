import type { Mailbox } from './harness/fixtures';
import { expect, test } from './harness/linking';

import { did, saw } from './ledger/record';

const WORK = 'work@example.com';
const ALIAS = 'sales@example.com';

/** The addresses of the inboxes the signed-in user has connected. */
async function connectedInboxes(mailbox: Mailbox): Promise<string[]> {
  const response = await mailbox.api('/email/email/links');
  const { links } = (await response.json()) as {
    links: { email_address: string }[];
  };
  return links.map((link) => link.email_address);
}

test.describe('an account whose mailbox has a send-as alias', () => {
  // Class link-aliases-shown-as-inboxes: a send-as alias is another address
  // of one inbox, not an inbox. When this fails the account menu offers "All
  // inboxes" to someone with a single inbox and lists the alias as an account.
  // Class link-connect-flow-ui: with no inbox connected, the mail view's
  // "Connect email" must reach consent and come back with the inbox listed.
  test('connecting it from the empty mail view lists one inbox, with the alias marked as an alias', async ({
    page,
    mailbox,
    auth,
  }) => {
    await auth.googleAccount({ email: WORK, send_as: [{ email: ALIAS }] });
    const removed = await mailbox.api(
      `/email/email/links/${mailbox.inbox.linkId}`,
      {
        method: 'DELETE',
      }
    );
    expect(removed.status).toBe(204);
    await expect.poll(() => connectedInboxes(mailbox)).toEqual([]);

    await mailbox.open('/app/mail');
    await page.getByRole('button', { name: 'Connect email' }).click();
    did('AL-045', 'F-001');
    await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
    await page.getByRole('button', { name: new RegExp(WORK) }).click();
    did('AX-031', 'F-001');

    await expect(page.getByText('Account connected')).toBeVisible();
    saw('STX-020', 'F-001');
    await expect(page).toHaveURL(/\/app\/mail$/);
    expect(await connectedInboxes(mailbox)).toEqual([WORK]);

    await page.getByRole('button', { name: `Select inbox: ${WORK}` }).click();
    const choices = page.getByRole('menu').getByRole('menuitemradio');
    await expect(choices.filter({ hasText: ALIAS })).toHaveText(/Alias/);
    await expect(choices).toHaveCount(2);
    await expect(choices.filter({ hasText: 'All inboxes' })).toHaveCount(0);
  });
});
