// The ways into a new email from outside the mail view's own controls: the
// app's Create menu, the phone's create button on Mail, and the universal
// input's Email type with its fields. Each for a Gmail and an Outlook inbox.

import { devices } from '@playwright/test';
import { expect, test } from './harness/linking';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  disconnectInbox,
  openUniversalInput,
  REQUEST,
  universalInput,
} from './harness/ways-elsewhere';
import { did } from './ledger/record';

const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];
const WORK = 'work@example.com';

for (const provider of PROVIDERS) {
  test.describe(`a new email from the Create menu, with ${anInbox(provider)}`, () => {
    test.use({ provider });

    // When this fails, "Email" in the app's Create menu opens no composer:
    // the entry is gone, or choosing it leaves the person where they were.
    test('Email in the Create menu opens a new message', async ({
      page,
      mailbox,
    }) => {
      await mailbox.open('/app/mail');
      await expect(page.getByText('Inbox').first()).toBeVisible();
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Create New' })
        .getByRole('option', { name: 'Email', exact: true })
        .click();
      did('AX-048');

      await expect(page).toHaveURL(/\/app\/mail\/new/);
      await expect(
        page.getByRole('dialog', { name: 'Create New' })
      ).toHaveCount(0);
      await expect(page.getByPlaceholder(/subject/i)).toHaveValue('');
      await expect(
        page.getByRole('button', { name: 'Send email' })
      ).toBeVisible();
    });
  });

  test.describe(`a new email from the phone's create button, with ${anInbox(provider)}`, () => {
    test.use({ ...phone, provider });

    // When this fails, the create button of the Mail page on a phone opens
    // no composer, or one that would not send from the connected inbox.
    test('the create button of the Mail page opens a new message', async ({
      page,
      mailbox,
    }) => {
      await mailbox.open('/app/mail');
      await page.getByRole('button', { name: 'New email' }).click();
      did('AX-304');

      await expect(page).toHaveURL(/\/app\/component\/email-compose/);
      await expect(page.getByRole('textbox', { name: 'Subject' })).toHaveValue(
        ''
      );
      await expect(
        page.getByRole('button', { name: `From: ${mailbox.inbox.email}` })
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Send email' })
      ).toBeVisible();
    });
  });

  test.describe(`an email in the universal input, with ${anInbox(provider)}`, () => {
    test.use({ provider });

    // When this fails, choosing Email in the universal input does not bring
    // up the email's fields, or a field does not keep what is put in it: the
    // sender chosen, a recipient in To, Cc or Bcc, the subject, the message.
    // Sending and saving are elsewhere.spec.ts's, so this stops at an email
    // that is ready to send.
    test('the Email type offers its fields, and they keep what is filled in', async ({
      page,
      mailbox,
    }) => {
      await mailbox.stack.link(mailbox.user, provider, WORK);
      await mailbox.open('/app/mail');
      await openUniversalInput(page);
      const input = universalInput(page);
      const send = input.getByRole('button', { name: 'Send email' });

      await page.getByRole('button', { name: 'Content type' }).click();
      await page.getByRole('option', { name: 'Email' }).click();
      did('AX-305');
      // "Auto · Email" is the app's guess; "Email" alone is the choice.
      await expect(
        page.getByRole('button', { name: 'Content type' })
      ).toHaveText('Email');
      await expect(input.getByRole('combobox', { name: 'To' })).toBeVisible();
      await expect(input.getByText('Choose a recipient')).toBeVisible();
      await expect(send).toBeDisabled();

      const from = input.getByRole('button', { name: 'From address' });
      await expect(from).toContainText(mailbox.inbox.email);
      await from.click();
      await page.getByRole('menuitem', { name: WORK }).click();
      await input.getByRole('button', { name: 'Cc/Bcc' }).click();
      for (const [field, address] of [
        ['To', 'bob@example.com'],
        ['Cc', 'carol@example.com'],
        ['Bcc', 'dave@example.com'],
      ] as const) {
        const recipients = input.getByRole('combobox', {
          name: field,
          exact: true,
        });
        await recipients.fill(address);
        await recipients.press('Enter');
      }
      await input.getByRole('textbox', { name: 'Subject' }).fill('Lunch moved');
      const message = input.getByRole('textbox', { name: 'Outgoing message' });
      await message.click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(' See you there.');
      did('AX-306');

      await expect(from).toContainText(WORK);
      for (const address of [
        'bob@example.com',
        'carol@example.com',
        'dave@example.com',
      ])
        await expect(input.getByRole('link', { name: address })).toBeVisible();
      await expect(input.getByRole('textbox', { name: 'Subject' })).toHaveValue(
        'Lunch moved'
      );
      await expect(message).toHaveText(`${REQUEST} See you there.`);
      // With a recipient the email is complete: nothing is asked for any more.
      await expect(input.getByText('Choose a recipient')).toHaveCount(0);
      await expect(send).toBeEnabled();
    });

    // When this fails, someone without an inbox who chooses Email in the
    // universal input is not offered a connection, or "Connect Google" does
    // not start one for mail and calendar.
    // The inbox is disconnected first, so the provider it had decides nothing.
    test('Connect Google in the universal input starts a connection when no inbox is connected', async ({
      page,
      mailbox,
      auth,
    }) => {
      await disconnectInbox(mailbox);
      await mailbox.open('/app/mail');
      await openUniversalInput(page);
      await page.getByRole('button', { name: 'Content type' }).click();
      await page.getByRole('option', { name: 'Email' }).click();

      await universalInput(page)
        .getByRole('button', { name: 'Connect Google' })
        .click();
      did('AX-051');

      await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
      expect(
        auth.starts.map(({ provider, scopes, reconnectLinkId }) => ({
          provider,
          scopes,
          reconnectLinkId,
        }))
      ).toEqual([
        {
          provider: 'GMAIL',
          scopes: 'gmail_and_calendar',
          reconnectLinkId: null,
        },
      ]);
    });
  });
}
