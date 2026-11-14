import type { Page } from '@playwright/test';
import type { Mailbox } from './harness/fixtures';
import { expect, test } from './harness/linking';
import { confirmed, did, saw } from './ledger/record';

/** The addresses of the inboxes the signed-in user has connected. */
async function connectedInboxes(mailbox: Mailbox): Promise<string[]> {
  const response = await mailbox.api('/email/email/links');
  const { links } = (await response.json()) as {
    links: { email_address: string }[];
  };
  return links.map((link) => link.email_address).sort();
}

/** The scopes the provider's consent page is asking the person to grant. */
async function scopesOnConsentPage(page: Page): Promise<string[]> {
  await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  const scopes = await page
    .locator('label:has(input[type="checkbox"])')
    .allInnerTexts();
  return scopes.map((scope) => scope.trim()).sort();
}

const MAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

test.describe('connecting another account', () => {
  // Class link-connect-flow-ui: the consent round trip leaves the app, and
  // both a cancelled and a finished consent must come back to the view it
  // started from and say what happened. When this fails the person lands on
  // a default screen (their open thread gone) or the flow dead-ends.
  // Class calendar-scope-through-consent: a plain connect asks for mail
  // access only; when that fails, consent asks for a calendar nobody opted
  // into.
  test('a cancelled, then a completed consent each return to the open thread, and the new inbox is listed', async ({
    page,
    mailbox,
    auth,
  }) => {
    await auth.googleAccount({ email: 'work@example.com' });
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Lunch?',
      text: 'Noon at the usual place?',
    });
    const thread = await mailbox.synced('Lunch?');
    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');
    await expect(
      page.getByText('Noon at the usual place?').first()
    ).toBeVisible();
    saw('STL-951');

    await page.getByRole('button', { name: 'Connect another account' }).click();
    did('AL-044');
    expect(await scopesOnConsentPage(page)).toEqual([MAIL_SCOPE]);
    await page.getByRole('button', { name: 'Cancel' }).click();
    did('AX-032');

    await expect(page.getByText('Account not connected')).toBeVisible();
    saw('STX-022');
    await expect(page).toHaveURL(new RegExp(`/app/mail/${thread.id}$`));
    await expect(
      page.getByText('Noon at the usual place?').first()
    ).toBeVisible();
    expect(await connectedInboxes(mailbox)).toEqual([mailbox.inbox.email]);

    await page.getByRole('button', { name: 'Connect another account' }).click();
    did('AL-044');
    expect(await scopesOnConsentPage(page)).toEqual([MAIL_SCOPE]);
    await page.getByRole('button', { name: /work@example\.com/ }).click();
    did('AX-031', 'F-001');

    await expect(page.getByText('Account connected')).toBeVisible();
    saw('STX-020', 'F-001');
    await expect(page).toHaveURL(new RegExp(`/app/mail/${thread.id}$`));
    await expect(
      page.getByText('Noon at the usual place?').first()
    ).toBeVisible();
    await expect
      .poll(() => connectedInboxes(mailbox))
      .toEqual([mailbox.inbox.email, 'work@example.com'].sort());
    confirmed('F-004');
    await page.getByRole('button', { name: /^Select inbox/ }).click();
    await expect(
      page.getByRole('menu').getByText('work@example.com')
    ).toBeVisible();

    expect(auth.starts.map((start) => start.scopes)).toEqual([
      'gmail',
      'gmail',
    ]);
  });

  // Class link-connect-flow-ui: choosing an account that is already
  // connected adds nothing, and the app must say so. When this fails the
  // person is told "Account connected" and looks for an inbox that is not
  // there.
  test('choosing the account that is already connected says so and adds nothing', async ({
    page,
    mailbox,
    auth,
  }) => {
    await mailbox.open('/app/mail');
    await page.getByRole('button', { name: 'Connect another account' }).click();
    did('AL-044');
    await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
    await page
      .getByRole('button', { name: new RegExp(mailbox.inbox.email) })
      .click();

    await expect(
      page.getByText(`${mailbox.inbox.email} is already connected`)
    ).toBeVisible();
    saw('STX-021');
    await expect(page).toHaveURL(/\/app\/mail$/);
    expect(await connectedInboxes(mailbox)).toEqual([mailbox.inbox.email]);
    expect(auth.starts).toHaveLength(1);
  });
});

test.describe('connecting when Outlook is offered', () => {
  test.use({ outlookOffered: true });

  // Class link-connect-flow-ui: with two providers on offer the app asks
  // which one first. Backing out of that choice must start nothing and leave
  // the person where they were, and the choice must still work afterwards.
  // When this fails the dialog never opens, or cancelling it navigates away.
  test('backing out of the provider choice starts nothing, and choosing Gmail afterwards reaches consent', async ({
    page,
    mailbox,
    auth,
  }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Lunch?',
      text: 'Noon at the usual place?',
    });
    await mailbox.synced('Lunch?');
    await mailbox.open('/app/mail');
    const connect = page.getByRole('button', {
      name: 'Connect another account',
    });
    const chooser = page
      .getByRole('dialog')
      .filter({ hasText: 'Connect email' });

    await connect.click();
    did('AL-044');
    await expect(
      chooser.getByRole('button', { name: /Outlook/ })
    ).toBeVisible();
    saw('STX-209', 'F-001');
    await chooser.getByRole('button', { name: 'Cancel' }).click();
    did('AX-030');
    await expect(chooser).toBeHidden();
    await expect(page.getByText('Lunch?').first()).toBeVisible();
    await expect(page).toHaveURL(/\/app\/mail$/);

    await connect.click();
    did('AL-044');
    await chooser.getByRole('button', { name: 'Gmail' }).click();
    did('AX-028');
    expect(await scopesOnConsentPage(page)).toEqual([MAIL_SCOPE]);
    expect(auth.starts.map((start) => start.provider)).toEqual(['GMAIL']);
  });
});

test.describe('connecting from Settings', () => {
  // Class link-connect-flow-ui: cancelling consent started from Settings
  // must bring the person back to Settings, still open beside their mail.
  // When this fails Settings is closed, or another screen is shown.
  test('cancelling consent started from Settings returns to Settings', async ({
    page,
    mailbox,
    auth,
  }) => {
    await mailbox.open('/app/mail/~/settings/email');
    const connect = page.getByRole('button', {
      name: 'Connect a Google Workspace account',
    });
    await connect.click();
    did('AX-001', 'F-004');
    expect(await scopesOnConsentPage(page)).toEqual([MAIL_SCOPE]);
    expect(auth.starts.map((start) => start.scopes)).toEqual(['gmail']);
    await page.getByRole('button', { name: 'Cancel' }).click();
    did('AX-032');

    await expect(page.getByText('Account not connected')).toBeVisible();
    saw('STX-022');
    await expect(page).toHaveURL(/\/app\/mail\/~\/settings\/email$/);
    await expect(connect).toBeVisible();
    expect(await connectedInboxes(mailbox)).toEqual([mailbox.inbox.email]);
  });
});

test.describe('calendar access for a connected inbox', () => {
  // Class calendar-scope-through-consent: turning calendar on for an inbox
  // that already has mail access asks for the calendar alone, for that
  // inbox. When this fails, consent asks for mail access again (and Google
  // shows the full permission screen for a one-permission upgrade).
  test('enabling calendar asks consent for the calendar only, for that inbox', async ({
    page,
    mailbox,
    auth,
  }) => {
    await mailbox.open('/app/mail/~/settings/email');
    await page
      .getByRole('button', {
        name: `Enable calendar for ${mailbox.inbox.email}`,
      })
      .click();
    did('AX-005');

    expect(await scopesOnConsentPage(page)).toEqual([CALENDAR_SCOPE]);
    expect(new URL(page.url()).searchParams.get('login_hint')).toBe(
      mailbox.inbox.email
    );
    expect(
      auth.starts.map(({ scopes, reconnectLinkId }) => ({
        scopes,
        reconnectLinkId,
      }))
    ).toEqual([{ scopes: 'calendar', reconnectLinkId: mailbox.inbox.linkId }]);
  });
});
