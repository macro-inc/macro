// More of connecting inboxes: sharing an inbox someone else connected,
// enabling a disabled one, connecting during onboarding, what the app says
// about an inbox whose access stopped, and the send-as aliases of an inbox.
// Gmail connections go through the Gmail emulator's consent page; an Outlook
// mailbox is connected by the harness, so only what follows a connection is
// shown for Outlook.

import { loadAppSteadily } from './harness/drafts';
import type { Mailbox } from './harness/fixtures';
import { emulatorUrl } from './harness/journeys';
import { expect, test } from './harness/linking';
import type { Provider } from './harness/stack';
import { confirmed, did, saw } from './ledger/record';

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];
const SETTINGS = '/app/mail/~/settings/email';

type Link = {
  id: string;
  email_address: string;
  needs_reauth: boolean;
  is_primary: boolean;
};

/** The inboxes the signed-in user has connected, as the email service lists them. */
async function links(mailbox: Mailbox): Promise<Link[]> {
  const response = await mailbox.api('/email/email/links');
  return ((await response.json()) as { links: Link[] }).links;
}

async function connectedInboxes(mailbox: Mailbox): Promise<string[]> {
  return (await links(mailbox)).map((link) => link.email_address).sort();
}

/** Removes the inbox the test started with. */
async function removeInbox(mailbox: Mailbox): Promise<void> {
  const removed = await mailbox.api(
    `/email/email/links/${mailbox.inbox.linkId}`,
    { method: 'DELETE' }
  );
  expect(removed.status).toBe(204);
  await expect
    .poll(() => connectedInboxes(mailbox))
    .not.toContain(mailbox.inbox.email);
}

/** Makes the signed-in user someone whose first-run tutorial is not done. */
function becomeFirstRun(mailbox: Mailbox): void {
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

/** Withdraws the inbox's grant at its provider and has Macro notice. */
async function revokeAtProvider(mailbox: Mailbox): Promise<void> {
  const address = mailbox.inbox.email;
  const revoked = await fetch(
    `${emulatorUrl(mailbox, mailbox.inbox.provider)}/_emulator/mailboxes/${encodeURIComponent(address)}/revoke`,
    { method: 'POST' }
  );
  expect(revoked.ok).toBe(true);
  await expect
    .poll(async () => {
      await mailbox.api('/email/email/links/health-check', { method: 'POST' });
      return (await links(mailbox)).some(
        (link) => link.email_address === address && link.needs_reauth
      );
    })
    .toBe(true);
}

/**
 * The Gmail API calls made for a mailbox that Gmail answered, oldest first.
 * The consent's own calls (`oauth.*`) are left out: the harness makes them.
 */
async function answeredGmailCalls(
  mailbox: Mailbox,
  address: string
): Promise<string[]> {
  const requests = (await (
    await fetch(
      `${mailbox.stack.info.gmailUrl}/_emulator/requests?mailbox=${encodeURIComponent(address)}`
    )
  ).json()) as { route: string | null; status: number }[];
  return requests
    .filter(({ route, status }) => status < 300 && !route?.startsWith('oauth.'))
    .map(({ route }) => route ?? '');
}

for (const provider of PROVIDERS) {
  test.describe(`${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox whose access was withdrawn at the provider`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, an inbox that stopped syncing says nothing: no prompt
    // names it, "Maybe later" does not put the prompt away, or Settings shows
    // the inbox as healthy.
    test('the app prompts to reconnect it, the prompt can be put off, and Settings shows why', async ({
      page,
      mailbox,
    }) => {
      const address = mailbox.inbox.email;
      await revokeAtProvider(mailbox);

      await mailbox.open('/app/mail');
      // An inbox that also has calendar access is named with its calendar.
      const prompt = page
        .getByRole('status', {
          name: /^Reconnect (inbox|email and calendar)$/,
        })
        .filter({
          hasText: `Sync stopped for ${address}. Reconnect to restore`,
        });
      await expect(prompt).toBeVisible();
      saw('STX-028');
      await page.getByRole('button', { name: 'Maybe later' }).click();
      did('AX-208');
      await expect(prompt).toBeHidden();

      await mailbox.open(SETTINGS);
      await expect(
        page.getByRole('button', { name: `Reconnect ${address}` })
      ).toBeVisible();
      await expect(page.getByText('Reconnect to resume sync')).toBeVisible();
      saw('STX-007');
    });
  });
}

test.describe('someone with no inbox connected', () => {
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a composer opened without an inbox does not say that
  // none is connected, or its "Connect Gmail" does not start a connection.
  test('a new email says no account is connected, and its Connect Gmail reaches consent', async ({
    page,
    mailbox,
    auth,
  }) => {
    await removeInbox(mailbox);

    await mailbox.open('/app/mail/new');
    await expect(page.getByText('No email account connected.')).toBeVisible();
    saw('STC-110');
    await page.getByRole('button', { name: 'Connect Gmail' }).click();
    did('AC-321');
    await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
    expect(auth.starts.map(({ provider }) => provider)).toEqual(['GMAIL']);
  });
});

test.describe('an inbox a teammate already connected', () => {
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, connecting an inbox someone else already has does not
  // ask before sharing it, Cancel shares it anyway, or "Share inbox" leaves
  // the user without the inbox.
  test('connecting it asks first: Cancel adds nothing, Share inbox lists it as shared', async ({
    page,
    mailbox,
    auth,
  }) => {
    const team = 'team@example.com';
    await auth.googleAccount({ email: team });
    const bob = await mailbox.stack.user('bob@example.com');
    await mailbox.stack.link(bob, 'GMAIL', team);

    await mailbox.open(SETTINGS);
    const connect = page.getByRole('button', {
      name: 'Connect a Google Workspace account',
    });
    await connect.click();
    await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
    await page.getByRole('button', { name: new RegExp(team) }).click();

    const dialog = page.getByRole('dialog').filter({
      hasText: 'Share this inbox?',
    });
    await expect(dialog).toBeVisible();
    saw('STX-213');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    did('AX-038');
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('button', { name: `Remove ${mailbox.inbox.email}` })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Remove ${team}` })
    ).toHaveCount(0);
    expect(await connectedInboxes(mailbox)).toEqual([mailbox.inbox.email]);

    await connect.click();
    await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
    await page.getByRole('button', { name: new RegExp(team) }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Share inbox' }).click();
    did('AX-037');

    await expect(page.getByText('Account connected')).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Remove ${team}` })
    ).toBeVisible();
    await expect(page.getByText('Shared', { exact: true })).toBeVisible();
    saw('STX-967');
    expect(await connectedInboxes(mailbox)).toEqual([
      mailbox.inbox.email,
      team,
    ]);
    confirmed('F-005');
  });
});

test.describe('a primary inbox that was disabled', () => {
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, Settings does not offer to enable the account's own
  // inbox once it is disabled, or Enable does not bring it back.
  test('Enable in Settings connects it again and the row reads as a connected primary inbox', async ({
    page,
    mailbox,
    auth,
  }) => {
    const address = mailbox.inbox.email;
    const work = 'work@example.com';
    // The account's own inbox reads as disabled once it is gone and another
    // inbox is still connected.
    await auth.googleAccount({ email: work });
    await mailbox.stack.link(mailbox.user, 'GMAIL', work);
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Lunch?',
      text: 'Noon at the usual place?',
    });
    await mailbox.synced('Lunch?');
    await removeInbox(mailbox);

    await mailbox.open(SETTINGS);
    await expect(page.getByText('Sync disabled')).toBeVisible();
    await expect(page.getByText('Disabled', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Enable', exact: true }).click();
    did('AX-003');
    await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
    await page.getByRole('button', { name: new RegExp(address) }).click();

    await expect(page).toHaveURL(/\/app\/mail\/~\/settings\/email$/);
    await expect(
      page.getByRole('button', { name: `Remove ${address}` })
    ).toBeVisible();
    await expect(page.getByText('Sync disabled')).toBeHidden();
    await expect(page.getByText('Primary', { exact: true })).toBeVisible();
    // The inbox is read again from Google once it is back.
    const enabled = (await links(mailbox)).find(
      ({ email_address }) => email_address === address
    );
    await expect
      .poll(
        async () => {
          const response = await mailbox.api(
            '/email/email/threads/previews/cursor/all?limit=100',
            { headers: { 'x-email-link-id': enabled?.id ?? '' } }
          );
          const { items } = (await response.json()) as {
            items: { name: string }[];
          };
          return items.map(({ name }) => name);
        },
        { timeout: 60_000 }
      )
      .toContain('Lunch?');
    await mailbox.open('/app/mail');
    await expect(page.getByText('Lunch?').first()).toBeVisible();
    saw('STX-921');
    expect(auth.starts).toHaveLength(1);
    expect(
      (await links(mailbox))
        .filter(({ email_address }) => email_address === address)
        .map(({ is_primary }) => is_primary)
    ).toEqual([true]);
    confirmed('F-008');
  });
});

test.describe('a new sign-up in onboarding', () => {
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the onboarding step cannot connect the work inbox, does
  // not come back to itself after consent, or does not show the inbox as
  // connected.
  test('connecting the work email returns to the step, which shows it connected', async ({
    page,
    mailbox,
    auth,
  }) => {
    await removeInbox(mailbox);
    becomeFirstRun(mailbox);

    await mailbox.open('/app/onboarding?step=work');
    await page.getByRole('button', { name: 'Connect work email' }).click();
    did('AX-042');
    await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
    await page
      .getByRole('button', { name: new RegExp(mailbox.inbox.email) })
      .click();

    await expect(page).toHaveURL(/\/app\/onboarding/);
    await expect(page.getByText('Work email connected')).toBeVisible();
    saw('STX-214');
    expect(auth.starts).toHaveLength(1);
    expect(await connectedInboxes(mailbox)).toEqual([mailbox.inbox.email]);
    confirmed('F-010');
  });
});

test.describe('an Outlook user in onboarding', () => {
  test.use({ provider: 'OUTLOOK' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, onboarding does not recognise an Outlook inbox as the
  // connected work email and asks to connect one again.
  test('the email step shows the Outlook inbox as the connected work email', async ({
    page,
    mailbox,
  }) => {
    becomeFirstRun(mailbox);

    await mailbox.open('/app/onboarding?step=work');

    await expect(page.getByText('Work email connected')).toBeVisible();
    saw('STX-214');
    await expect(
      page.getByRole('button', { name: 'Connect work email' })
    ).toHaveCount(0);
  });
});

test.describe('a second Outlook inbox', () => {
  test.use({ provider: 'OUTLOOK' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a second Outlook inbox is missing from the inbox
  // picker, or choosing it does not show its mail.
  test('is listed in the inbox picker beside the first, and choosing it shows its mail', async ({
    page,
    mailbox,
  }) => {
    const work = 'work@example.com';
    await mailbox.stack.link(mailbox.user, 'OUTLOOK', work);
    await mailbox.stack.deliver(work, {
      from: 'Grace <grace@example.com>',
      subject: 'Budget review',
      text: 'Numbers attached.',
    });
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Lunch?',
      text: 'Noon at the usual place?',
    });
    await mailbox.synced('Lunch?');
    await mailbox.synced('Budget review');

    await mailbox.open('/app/mail');
    await page.getByRole('button', { name: /^Select inbox/ }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByText(mailbox.inbox.email)).toBeVisible();
    await expect(menu.getByText(work)).toBeVisible();
    saw('STX-965');
    await menu.getByText(work).click();
    await expect(page.getByText('Budget review').first()).toBeVisible();
    await expect(page.getByText('Lunch?')).toHaveCount(0);
  });
});

test.describe('a Gmail inbox whose access was withdrawn', () => {
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the Reconnect action of the prompt does not start a
  // reconnection of that inbox, or the prompt stays after consent.
  test('Reconnect on the prompt goes through consent and the prompt is gone', async ({
    page,
    mailbox,
    auth,
  }) => {
    const address = mailbox.inbox.email;
    await revokeAtProvider(mailbox);

    await mailbox.open('/app/mail');
    const prompt = page.getByText(
      `Sync stopped for ${address}. Reconnect to restore email sync.`
    );
    await expect(prompt).toBeVisible();
    const before = (await answeredGmailCalls(mailbox, address)).length;
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    did('AX-039');
    await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
    await page.getByRole('button', { name: new RegExp(address) }).click();

    await expect(page).toHaveURL(/\/app\/mail/);
    await expect(page.getByText('Account connected')).toBeVisible();
    await expect(prompt).toBeHidden();
    expect(auth.starts.map(({ reconnectLinkId }) => reconnectLinkId)).toEqual([
      mailbox.inbox.linkId,
    ]);
    await expect
      .poll(async () =>
        (await links(mailbox)).map(({ needs_reauth }) => needs_reauth)
      )
      .toEqual([false]);

    await mailbox.open(SETTINGS);
    await expect(
      page.getByRole('button', { name: `Remove ${address}` })
    ).toBeVisible();
    await expect(page.getByText('Reconnect to resume sync')).toBeHidden();
    saw('STX-920');
    const accounts = (await (
      await fetch(`${mailbox.stack.info.gmailUrl}/_emulator/mailboxes`)
    ).json()) as {
      email: string;
      revoked: boolean;
      watch_expires_at: string | null;
    }[];
    const account = accounts.find(({ email }) => email === address);
    expect(account?.revoked).toBe(false);
    expect(account?.watch_expires_at).not.toBeNull();
    // Macro reaches the mailbox at Google again: Google refused every call
    // while the grant was withdrawn, and answers the ones made since consent.
    await expect
      .poll(async () =>
        (await answeredGmailCalls(mailbox, address)).slice(before)
      )
      .not.toEqual([]);
    confirmed('F-007');
  });
});

test.describe('a Gmail inbox with send-as aliases at Google', () => {
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the aliases Google holds for an inbox are not read, or
  // the composer does not offer them as From addresses.
  test('the composer offers the inbox and each of its aliases as From addresses', async ({
    page,
    mailbox,
    auth,
  }) => {
    const work = 'work@example.com';
    const aliases = ['sales@example.com', 'billing@example.com'];
    await auth.googleAccount({
      email: work,
      send_as: aliases.map((email) => ({ email })),
    });
    await mailbox.stack.link(mailbox.user, 'GMAIL', work);

    await mailbox.open('/app/mail/new');
    await page.getByRole('button', { name: 'From address' }).click();
    const choices = page.getByRole('menuitem');
    for (const address of [mailbox.inbox.email, work, ...aliases]) {
      await expect(choices.filter({ hasText: address })).toHaveCount(1);
    }
    saw('STC-307', 'F-015');
    // Google was asked for the aliases of that inbox.
    const asked = (await (
      await fetch(
        `${mailbox.stack.info.gmailUrl}/_emulator/requests?route=settings.sendAs.list&mailbox=${encodeURIComponent(work)}`
      )
    ).json()) as unknown[];
    expect(asked.length).toBeGreaterThan(0);
    // And what the menu offers for it is what Google holds: its send-as
    // list, read the way a Gmail client reads it.
    const { access_token: token } = (await (
      await fetch(
        `${mailbox.stack.info.gmailUrl}/_emulator/mailboxes/${encodeURIComponent(work)}/access-tokens`,
        { method: 'POST' }
      )
    ).json()) as { access_token: string };
    const { sendAs } = (await (
      await fetch(
        `${mailbox.stack.info.gmailUrl}/gmail/v1/users/me/settings/sendAs`,
        { headers: { authorization: `Bearer ${token}` } }
      )
    ).json()) as { sendAs: { sendAsEmail: string }[] };
    const held = sendAs.map((alias) => alias.sendAsEmail);
    expect([...held].sort()).toEqual([work, ...aliases].sort());
    for (const address of held) {
      await expect(choices.filter({ hasText: address })).toHaveCount(1);
    }
    await expect(choices).toHaveCount(held.length + 1);
    confirmed('F-015');
  });
});
