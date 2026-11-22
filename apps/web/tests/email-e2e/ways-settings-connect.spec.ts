// What connecting another inbox comes back to when consent did not end in a
// connection: the "Email access required" prompt of a Google consent whose
// mail permission was unchecked, the provider chooser it reopens, leaving the
// return page while it is still finishing, and the "Admin approval required"
// dialog of a Microsoft 365 account whose administrator has not approved Macro.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { notice } from './harness/send';
import { SETTINGS } from './harness/ways-settings';
import {
  connectedInboxes,
  expect,
  refuseMailAccess,
  test,
} from './harness/ways-settings-more';
import { did } from './ledger/record';

const WORK = 'work@example.com';

/** The provider chooser, opened by the app shell or by a retry. */
const chooser = (page: Page) =>
  page.getByRole('dialog').filter({ hasText: 'Connect email' });

/** The prompt a consent without the mail permission leaves behind. */
const accessPrompt = (page: Page) => notice(page, 'Email access required');

test.beforeEach(({ page }) => loadAppSteadily(page));

test.describe('a Google consent that withheld the mail permission', () => {
  // When this fails, "Maybe later" leaves the prompt up or starts a new
  // connection, or "Try again" fails to restart the sole available provider.
  test('Maybe later puts the prompt away and Try again starts the sole Gmail provider directly', async ({
    page,
    mailbox,
    auth,
  }) => {
    await auth.googleAccount({ email: WORK });
    await mailbox.open('/app/mail');
    const connect = page.getByRole('button', {
      name: 'Connect another account',
    });

    await connect.click();
    await refuseMailAccess(page, WORK);
    await expect(accessPrompt(page)).toBeVisible();
    await expect(page).toHaveURL(/\/app\/mail$/);
    await accessPrompt(page)
      .getByRole('button', { name: 'Maybe later' })
      .click();
    did('AX-210');
    await expect(accessPrompt(page)).toBeHidden();
    await expect(chooser(page)).toBeHidden();
    expect(auth.starts).toHaveLength(1);

    await connect.click();
    await refuseMailAccess(page, WORK);
    await accessPrompt(page).getByRole('button', { name: 'Try again' }).click();
    did('AX-041');
    await expect(accessPrompt(page)).toBeHidden();
    // b926309927a restores the sole-provider shortcut on retry as well.
    await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
    await expect(chooser(page)).toBeHidden();
    expect(auth.starts.map((start) => start.provider)).toEqual([
      'GMAIL',
      'GMAIL',
      'GMAIL',
    ]);
    await refuseMailAccess(page, WORK);
    await expect(accessPrompt(page)).toBeVisible();
    await accessPrompt(page)
      .getByRole('button', { name: 'Maybe later' })
      .click();
    await expect(accessPrompt(page)).toBeHidden();
    await expect(page).toHaveURL(/\/app\/mail$/);
    expect(await connectedInboxes(mailbox)).toEqual([mailbox.inbox.email]);
  });
});

test.describe('retrying a consent when Outlook is offered too', () => {
  test.use({ outlookOffered: true });

  test('Cancel in the retry chooser starts neither of the two offered providers', async ({
    page,
    mailbox,
    auth,
  }) => {
    await auth.googleAccount({ email: WORK });
    await mailbox.open('/app/mail');
    await page.getByRole('button', { name: 'Connect another account' }).click();
    await chooser(page)
      .getByRole('button', { name: 'Gmail', exact: true })
      .click();
    await refuseMailAccess(page, WORK);
    await accessPrompt(page).getByRole('button', { name: 'Try again' }).click();
    await expect(accessPrompt(page)).toBeHidden();
    await expect(
      chooser(page).getByRole('button', { name: 'Gmail', exact: true })
    ).toBeVisible();
    await expect(
      chooser(page).getByRole('button', {
        name: 'Outlook / Microsoft 365',
        exact: true,
      })
    ).toBeVisible();
    expect(auth.starts.map((start) => start.provider)).toEqual(['GMAIL']);
    await chooser(page)
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    did('AX-207');
    await expect(chooser(page)).toBeHidden();
    await expect(page).toHaveURL(/\/app\/mail$/);
    expect(auth.starts.map((start) => start.provider)).toEqual(['GMAIL']);
    expect(await connectedInboxes(mailbox)).toEqual([mailbox.inbox.email]);
  });

  // When this fails, a provider chosen in the chooser that "Try again"
  // opens does not lead to that provider's sign-in, or choosing Gmail there
  // does not connect the account picked.
  test('the chooser Try again opens leads to Outlook sign-in, or to Gmail consent that connects the account', async ({
    page,
    mailbox,
    auth,
  }) => {
    await auth.googleAccount({ email: WORK });
    const retry = async () => {
      await mailbox.open('/app/mail');
      await page
        .getByRole('button', { name: 'Connect another account' })
        .click();
      await chooser(page).getByRole('button', { name: 'Gmail' }).click();
      await refuseMailAccess(page, WORK);
      await accessPrompt(page)
        .getByRole('button', { name: 'Try again' })
        .click();
      did('AX-041');
      await expect(chooser(page)).toBeVisible();
    };

    await retry();
    await chooser(page)
      .getByRole('button', { name: 'Outlook / Microsoft 365' })
      .click();
    did('AX-206', 'F-002');
    await expect(
      page.getByRole('button', { name: 'Need admin approval' })
    ).toBeVisible();
    expect(auth.starts.at(-1)?.provider).toBe('OUTLOOK');

    await retry();
    await chooser(page).getByRole('button', { name: 'Gmail' }).click();
    did('AX-206', 'F-001');
    await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
    await page.getByRole('button', { name: /work@example\.com/ }).click();
    await expect(page.getByText('Account connected')).toBeVisible();
    await expect
      .poll(() => connectedInboxes(mailbox))
      .toEqual([mailbox.inbox.email, WORK].sort());
    expect(auth.starts.map((start) => start.provider)).toEqual([
      'GMAIL',
      'OUTLOOK',
      'GMAIL',
      'GMAIL',
    ]);
  });
});

test.describe('the page a finished consent returns to', () => {
  // When this fails, "Back to app" on the page that is still finishing the
  // connection does not go back to the page the person left (Settings ›
  // Email here, not the Connected page a callback falls back to), or the
  // connection it was finishing is lost by leaving.
  test('Back to app returns to the page left while the connection still finishes', async ({
    page,
    mailbox,
    auth,
  }) => {
    const own = mailbox.inbox.email;
    await auth.googleAccount({ email: WORK });
    // The email service's half of the connection waits until released.
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finishing = 0;
    await page.route(/\/email\/email\/init(\?|$)/, async (route) => {
      finishing += 1;
      await released;
      await route.fallback();
    });

    await mailbox.open(SETTINGS);
    const row = page.getByRole('button', { name: `Remove ${own}` });
    await expect(row).toBeVisible();
    await page
      .getByRole('button', { name: 'Connect a Google Workspace account' })
      .click();
    await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
    await page.getByRole('button', { name: /work@example\.com/ }).click();
    const waiting = page
      .getByRole('status')
      .filter({ hasText: 'Finishing account connection…' });
    await expect(waiting).toBeVisible();
    await expect.poll(() => finishing).toBe(1);

    await waiting.getByRole('button', { name: 'Back to app' }).click();
    did('AX-033');
    await expect(page).toHaveURL(new RegExp(`${SETTINGS}$`));
    await expect(row).toBeVisible();
    await expect(waiting).toBeHidden();

    release();
    await expect
      .poll(() => connectedInboxes(mailbox))
      .toEqual([mailbox.inbox.email, WORK].sort());
  });
});

test.describe('a Microsoft 365 account that needs admin approval', () => {
  test.use({ provider: 'OUTLOOK', outlookOffered: true });

  // When this fails, "Connect a different account" in "Admin approval
  // required" does not offer the providers again, or choosing one there does
  // not start a connection with it.
  test('Connect a different account offers the providers again, and Gmail there reaches consent', async ({
    page,
    mailbox,
    auth,
  }) => {
    await mailbox.open('/app/mail');
    await page.getByRole('button', { name: 'Connect another account' }).click();
    await chooser(page)
      .getByRole('button', { name: 'Outlook / Microsoft 365' })
      .click();
    await page.waitForURL(/\/oauth2\/v2\.0\/authorize/);
    await page.getByRole('button', { name: 'Need admin approval' }).click();

    const approval = page
      .getByRole('dialog')
      .filter({ hasText: 'Admin approval required' });
    await approval
      .getByRole('button', { name: 'Connect a different account' })
      .click();
    did('AX-035');
    await expect(approval).toBeHidden();
    await expect(
      chooser(page).getByRole('button', { name: 'Outlook / Microsoft 365' })
    ).toBeVisible();
    await expect(page).toHaveURL(/\/app\/mail$/);

    await chooser(page).getByRole('button', { name: 'Gmail' }).click();
    await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
    expect(auth.starts.map((start) => start.provider)).toEqual([
      'OUTLOOK',
      'GMAIL',
    ]);
    expect(await connectedInboxes(mailbox)).toEqual([mailbox.inbox.email]);
  });
});
