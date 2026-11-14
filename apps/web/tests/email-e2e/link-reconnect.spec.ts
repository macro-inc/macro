import type { Mailbox } from './harness/fixtures';
import { expect, test } from './harness/linking';
import { confirmed, did, saw } from './ledger/record';

type GoogleAccount = {
  email: string;
  revoked: boolean;
  watch_expires_at: string | null;
};

/** The inbox's account as Google holds it: its grant and its push watch. */
async function googleAccount(mailbox: Mailbox): Promise<GoogleAccount> {
  const response = await fetch(
    `${mailbox.stack.info.gmailUrl}/_emulator/mailboxes`
  );
  const accounts = (await response.json()) as GoogleAccount[];
  const account = accounts.find(({ email }) => email === mailbox.inbox.email);
  if (!account) throw new Error(`Google has no ${mailbox.inbox.email}`);
  return account;
}

/** Whether the email service holds the inbox as needing its grant renewed. */
async function needsReconnect(mailbox: Mailbox): Promise<boolean> {
  const response = await mailbox.api('/email/email/links');
  const { links } = (await response.json()) as {
    links: { email_address: string; needs_reauth: boolean }[];
  };
  return links.some(
    (link) => link.email_address === mailbox.inbox.email && link.needs_reauth
  );
}

test.describe('an inbox whose access was revoked at Google', () => {
  // Class link-reconnect: when the grant of an inbox is revoked at the
  // provider, Settings must offer to reconnect it, and consenting again must
  // clear the prompt and bring its mail back. When this fails the inbox stays
  // on "Reconnect to resume sync" after consent, or its new mail never
  // arrives.
  test('reconnecting it through consent clears the prompt and its new mail arrives', async ({
    page,
    mailbox,
    auth,
  }) => {
    const address = mailbox.inbox.email;
    const revoked = await fetch(
      `${mailbox.stack.info.gmailUrl}/_emulator/mailboxes/${encodeURIComponent(address)}/revoke`,
      { method: 'POST' }
    );
    expect(revoked.ok).toBe(true);
    await mailbox.api('/email/email/links/health-check', { method: 'POST' });
    await expect.poll(() => needsReconnect(mailbox)).toBe(true);
    expect((await googleAccount(mailbox)).revoked).toBe(true);

    await mailbox.open('/app/mail/~/settings/email');
    const reconnect = page.getByRole('button', {
      name: `Reconnect ${address}`,
    });
    await expect(page.getByText('Reconnect to resume sync')).toBeVisible();
    await reconnect.click();
    did('AX-004');
    await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
    await page.getByRole('button', { name: new RegExp(address) }).click();

    await expect(page).toHaveURL(/\/app\/mail\/~\/settings\/email$/);
    await expect(
      page.getByRole('button', { name: `Remove ${address}` })
    ).toBeVisible();
    await expect(reconnect).toHaveCount(0);
    await expect(page.getByText('Reconnect to resume sync')).toBeHidden();
    saw('STX-920');
    expect(
      auth.starts.map(({ scopes, reconnectLinkId }) => ({
        scopes,
        reconnectLinkId,
      }))
    ).toEqual([{ scopes: 'gmail', reconnectLinkId: mailbox.inbox.linkId }]);
    expect(await needsReconnect(mailbox)).toBe(false);

    // Mail that arrives at Google after the reconnect reaches the app only
    // if the renewed grant is the one in use there.
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Back again',
      text: 'Can you read this?',
    });
    await mailbox.synced('Back again');
    confirmed('F-007');
    const account = await googleAccount(mailbox);
    expect(account.revoked).toBe(false);
    expect(account.watch_expires_at).not.toBeNull();
  });
});
