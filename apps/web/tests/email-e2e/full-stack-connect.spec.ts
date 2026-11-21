// Connecting an Outlook account on the local stack, where the authentication
// service is the real one: the app starts the connection there, Microsoft's
// pages (the emulator's) ask who and what, and the service's callback brings
// the browser back to the app with the inbox connected. Also the detour for
// an organisation whose administrator has to approve Macro first.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import type { Provider } from './harness/stack';
import { confirmed, did, saw } from './ledger/record';

const SETTINGS = '/app/mail/~/settings/email';

/** Where each provider asks who is connecting. */
const CONSENT: Record<Provider, RegExp> = {
  GMAIL: /\/o\/oauth2\/v2\/auth/,
  OUTLOOK: /\/oauth2\/v2\.0\/authorize/,
};
/** The button in Settings that connects an inbox of each provider. */
const CONNECT: Record<Provider, string> = {
  GMAIL: 'Connect a Google Workspace account',
  OUTLOOK: 'Connect an Outlook account',
};
/** The button in onboarding that connects a work email of each provider. */
const ONBOARD: Record<Provider, string> = {
  GMAIL: 'Continue with Google',
  OUTLOOK: 'Continue with Microsoft',
};

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

/** Picks the account on the provider's consent page. */
async function consent(
  page: Page,
  provider: Provider,
  address: string
): Promise<void> {
  await page.waitForURL(CONSENT[provider]);
  await page
    .getByRole('button', { name: new RegExp(address.replace(/\./g, '\\.')) })
    .click();
}

function control(mailbox: Mailbox, rest = ''): string {
  const { gmailUrl, outlookUrl } = mailbox.stack.info;
  const emulator = mailbox.inbox.provider === 'GMAIL' ? gmailUrl : outlookUrl;
  return `${emulator}/_emulator/mailboxes${rest}`;
}

/** Whether the provider holds the inbox's grant as withdrawn. */
async function revokedAtProvider(
  mailbox: Mailbox
): Promise<boolean | undefined> {
  const accounts = (await (await fetch(control(mailbox))).json()) as {
    email: string;
    revoked: boolean;
  }[];
  return accounts.find(({ email }) => email === mailbox.inbox.email)?.revoked;
}

/** Withdraws the inbox's grant at its provider and has Macro notice. */
async function revokeAtProvider(mailbox: Mailbox): Promise<void> {
  const address = mailbox.inbox.email;
  const revoked = await fetch(
    control(mailbox, `/${encodeURIComponent(address)}/revoke`),
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

/** The mailboxes Macro subscribed to change notifications for, at Microsoft. */
async function subscribedMailboxes(mailbox: Mailbox): Promise<string[]> {
  const response = await fetch(
    `${mailbox.stack.info.outlookUrl}/_emulator/subscriptions`
  );
  const subscriptions = (await response.json()) as { mailbox: string }[];
  return subscriptions.map((each) => each.mailbox);
}

/** An Outlook account nobody has connected, with one message in it. */
async function workAccount(mailbox: Mailbox): Promise<string> {
  const work = mailbox.stack.address('work@example.com');
  await mailbox.stack.seed('OUTLOOK', work, [
    { from: 'Linus <linus@example.com>', subject: 'Budget', text: 'Numbers.' },
  ]);
  return work;
}

/** From the mail list to Microsoft's account picker. */
async function toMicrosoft(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Connect another account' }).click();
  did('AL-044');
  await page
    .getByRole('dialog', { name: 'Connect email' })
    .getByRole('button', { name: /Outlook/ })
    .click();
  did('AX-029');
  await page.waitForURL(/\/oauth2\/v2\.0\/authorize/);
  await expect(
    page.getByRole('heading', { name: 'Pick an account' })
  ).toBeVisible();
}

test.describe('connecting an Outlook account', { tag: '@full-stack' }, () => {
  test.use({ provider: 'OUTLOOK' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, an Outlook account cannot be connected: the connection
  // does not start at the authentication service, Microsoft's answer is not
  // taken, or the inbox is not there (or not watched) afterwards.
  test('a second account is connected from the mail list and its mail arrives', async ({
    page,
    mailbox,
  }) => {
    const work = await workAccount(mailbox);
    await mailbox.open('/app/mail');
    await toMicrosoft(page);
    await page.getByRole('button', { name: new RegExp(work) }).click();
    did('AX-031', 'F-002');

    await expect(notice(page, 'Account connected')).toBeVisible({
      timeout: 60_000,
    });
    saw('STX-020', 'F-002');
    await expect(page).toHaveURL(/\/app\/mail$/);
    await expect
      .poll(() => connectedInboxes(mailbox))
      .toEqual([mailbox.inbox.email, work].sort());
    confirmed('F-004');
    // Macro subscribed to the new mailbox at Microsoft: without that none
    // of its mail is announced.
    await expect
      .poll(() => subscribedMailboxes(mailbox), { timeout: 60_000 })
      .toContain(work);
    confirmed('F-002');

    await expect(
      page.getByRole('grid', { name: 'Email' }).getByText('Budget')
    ).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /^Select inbox/ }).click();
    await expect(page.getByRole('menu').getByText(work)).toBeVisible();
    saw('STX-965');
  });

  // When this fails, someone whose organisation requires an administrator's
  // approval is left without a way forward: the app does not say so, the
  // approval link does not lead to Microsoft's approval page, or the
  // approval does not let them connect.
  test('an account that needs administrator approval connects once it is approved', async ({
    page,
    mailbox,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const work = await workAccount(mailbox);
    await mailbox.open('/app/mail');
    await toMicrosoft(page);
    await page.getByRole('button', { name: /admin approval/i }).click();

    const required = page.getByRole('dialog', {
      name: 'Admin approval required',
    });
    await expect(
      required.getByText(
        'Your organization requires an IT admin to approve Macro before you can connect this account.'
      )
    ).toBeVisible();
    saw('STX-026');
    expect(await connectedInboxes(mailbox)).toEqual([mailbox.inbox.email]);

    await required
      .getByRole('button', { name: 'Copy admin approval link' })
      .click();
    did('AX-034');
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(link).pathname).toMatch(/\/v2\.0\/adminconsent$/);

    // The administrator opens the link and accepts for the organisation.
    await page.goto(link);
    await expect(
      page.getByRole('heading', { name: 'Permissions requested' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Accept' }).click();
    did('AX-036');
    await expect(notice(page, 'Approved. Try connecting again.')).toBeVisible({
      timeout: 60_000,
    });
    saw('STX-027');

    // The approval comes back to the app's start, not to the mail list.
    await mailbox.open('/app/mail');
    await toMicrosoft(page);
    await page.getByRole('button', { name: new RegExp(work) }).click();
    await expect(notice(page, 'Account connected')).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(() => subscribedMailboxes(mailbox), { timeout: 60_000 })
      .toContain(work);
    confirmed('F-003');
  });
});

for (const provider of PROVIDERS) {
  test.describe(`connecting ${anInbox(provider)} through its consent`, {
    tag: '@full-stack',
  }, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, connecting an inbox someone else already has does not
    // ask before sharing it, Cancel shares it anyway, or "Share inbox" leaves
    // the user without the inbox.
    test('an inbox a teammate connected is shared only once the user agrees', async ({
      page,
      mailbox,
    }) => {
      const owner = mailbox.stack.address('bob@example.com');
      const bob = await mailbox.stack.user(owner);
      const team = (await mailbox.stack.link(bob, provider, 'team@example.com'))
        .email;

      await mailbox.open(SETTINGS);
      const connect = page.getByRole('button', { name: CONNECT[provider] });
      await connect.click();
      await consent(page, provider, team);
      const dialog = page.getByRole('dialog').filter({
        hasText: 'Share this inbox?',
      });
      await expect(dialog).toContainText(
        `${team} is already connected by ${owner}`,
        { timeout: 60_000 }
      );
      saw('STX-213');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      did('AX-038');
      await expect(dialog).toBeHidden();
      expect(await connectedInboxes(mailbox)).toEqual([mailbox.inbox.email]);

      await connect.click();
      await consent(page, provider, team);
      await expect(dialog).toBeVisible({ timeout: 60_000 });
      await dialog.getByRole('button', { name: 'Share inbox' }).click();
      did('AX-037');
      await expect(notice(page, 'Account connected')).toBeVisible({
        timeout: 60_000,
      });
      await expect(
        page.getByRole('button', { name: `Remove ${team}` })
      ).toBeVisible();
      await expect(page.getByText('Shared', { exact: true })).toBeVisible();
      saw('STX-967');
      expect(await connectedInboxes(mailbox)).toEqual(
        [mailbox.inbox.email, team].sort()
      );
      confirmed('F-005');
    });

    // When this fails, an inbox whose access was withdrawn cannot be brought
    // back: Reconnect starts nothing, consent is not taken, or the inbox
    // still does not sync afterwards.
    test('an inbox whose access was withdrawn syncs again after Reconnect', async ({
      page,
      mailbox,
    }) => {
      const address = mailbox.inbox.email;
      await revokeAtProvider(mailbox);

      await mailbox.open('/app/mail');
      const prompt = page.getByText(`Sync stopped for ${address}. Reconnect`);
      await expect(prompt).toBeVisible();
      await page
        .getByRole('button', { name: 'Reconnect', exact: true })
        .click();
      did('AX-039');
      await consent(page, provider, address);

      await expect(notice(page, 'Account connected')).toBeVisible({
        timeout: 60_000,
      });
      await expect(prompt).toBeHidden();
      await expect
        .poll(async () =>
          (await links(mailbox)).map(({ needs_reauth }) => needs_reauth)
        )
        .toEqual([false]);

      // The provider answers Macro again: mail that arrives now is synced.
      expect(await revokedAtProvider(mailbox)).toBe(false);
      if (provider === 'OUTLOOK') {
        await expect
          .poll(() => subscribedMailboxes(mailbox), { timeout: 60_000 })
          .toContain(address);
      }
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Back again',
        text: 'Can you read this?',
      });
      await mailbox.synced('Back again');
      confirmed('F-007');
      await mailbox.open(SETTINGS);
      await expect(
        page.getByRole('button', { name: `Remove ${address}` })
      ).toBeVisible();
      await expect(page.getByText('Reconnect to resume sync')).toBeHidden();
      saw('STX-920');
    });

    // When this fails, Settings does not offer to enable the account's own
    // inbox once it is disabled, or Enable does not bring it back.
    test('Enable in Settings connects a disabled primary inbox again', async ({
      page,
      mailbox,
    }) => {
      const address = mailbox.inbox.email;
      // The account's own inbox reads as disabled once it is gone and another
      // inbox is still connected.
      await mailbox.stack.link(mailbox.user, provider, 'work@example.com');
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Lunch?',
        text: 'Noon at the usual place?',
      });
      await mailbox.synced('Lunch?');
      await removeInbox(mailbox);

      await mailbox.open(SETTINGS);
      await expect(page.getByText('Sync disabled')).toBeVisible();
      await page.getByRole('button', { name: 'Enable', exact: true }).click();
      did('AX-003');
      await page
        .getByRole('dialog', { name: 'Connect email' })
        .getByRole('button', {
          name: provider === 'GMAIL' ? 'Gmail' : /Outlook/,
        })
        .click();
      await consent(page, provider, address);

      await expect(page).toHaveURL(/\/app\/mail\/~\/settings\/email$/, {
        timeout: 60_000,
      });
      await expect(
        page.getByRole('button', { name: `Remove ${address}` })
      ).toBeVisible();
      await expect(page.getByText('Sync disabled')).toBeHidden();
      await expect
        .poll(async () =>
          (await links(mailbox))
            .filter(({ email_address }) => email_address === address)
            .map(({ is_primary }) => is_primary)
        )
        .toEqual([true]);
      confirmed('F-008');
      await mailbox.open('/app/mail');
      await expect(
        page.getByRole('grid', { name: 'Email' }).getByText('Lunch?')
      ).toBeVisible({ timeout: 60_000 });
      saw('STX-921');
    });

    // When this fails, the onboarding step cannot connect the work inbox,
    // does not come back to itself after consent, or does not show the inbox
    // as connected.
    test('onboarding connects the work email and shows it connected', async ({
      page,
      mailbox,
    }) => {
      await removeInbox(mailbox);
      const again = await mailbox.api('/auth/user/tutorial', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tutorialComplete: false }),
      });
      expect(again.ok).toBe(true);

      await mailbox.open('/app/onboarding?step=work');
      await page.getByRole('button', { name: ONBOARD[provider] }).click();
      did(provider === 'GMAIL' ? 'AX-042' : 'AX-043');
      await consent(page, provider, mailbox.inbox.email);

      await expect(page).toHaveURL(/\/app\/onboarding/, { timeout: 60_000 });
      await expect(page.getByText('Work email connected')).toBeVisible();
      saw('STX-214');
      await expect
        .poll(() => connectedInboxes(mailbox))
        .toEqual([mailbox.inbox.email]);
      confirmed('F-010');
    });
  });
}
