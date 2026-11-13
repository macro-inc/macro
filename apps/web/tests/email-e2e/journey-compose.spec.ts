// Journey: a new message with everything a new message can carry. A
// recipient picked from the suggestions, Cc and Bcc added by hand, a file
// attached, the inbox's signature. Each recipient gets one copy with the
// file and the signature, and only the sender's copy names the Bcc. The same
// journey for a Gmail and an Outlook inbox.

import type { Page } from '@playwright/test';
import { attach, loadAppSteadily, relayUploads } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { addMailbox, readMailbox, sentFolder } from './harness/journeys';
import { notice } from './harness/send';
import type { Provider } from './harness/stack';

/**
 * The recipient input of a composer row: `To`, `Cc` or `Bcc`. The inputs have
 * no names, so this takes the innermost element holding the row's label and
 * an input: the row itself, whose ancestors come before it in the document.
 */
function recipientInput(page: Page, row: 'To' | 'Cc' | 'Bcc') {
  return page
    .locator('div')
    .filter({ has: page.getByText(row, { exact: true }) })
    .filter({ has: page.getByRole('combobox') })
    .last()
    .getByRole('combobox');
}

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`a new message from ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a recipient of a new message misses it, the file or the
    // signature, or a Bcc recipient is exposed to the others or lost.
    test('a suggested recipient, Cc, Bcc, a file and the signature reach every recipient', async ({
      page,
      mailbox,
    }) => {
      const grace = 'grace@example.com';
      const zed = 'zed@example.com';
      const ida = 'ida@example.com';
      for (const address of [grace, zed, ida]) {
        await addMailbox(mailbox, address);
      }
      // Grace is someone Ada has written with: a contact the To field suggests.
      await mailbox.stack.sql(
        `INSERT INTO contacts_connections (user1, user2)
         VALUES (LEAST('macro|${grace}' COLLATE "C", '${mailbox.user.macroUserId}' COLLATE "C"),
                 GREATEST('macro|${grace}' COLLATE "C", '${mailbox.user.macroUserId}' COLLATE "C"))
         RETURNING user1`
      );
      const signature = await mailbox.api('/email/email/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          settings: { signature: '<p>Ada Lovelace, Analytical Engines</p>' },
        }),
      });
      expect(signature.ok).toBe(true);
      await relayUploads(page);

      await mailbox.open('/app/mail/new');
      const to = recipientInput(page, 'To');
      await to.fill('grac');
      await page.getByRole('option').filter({ hasText: grace }).click();
      await expect(to).toHaveValue('');

      await page.getByRole('button', { name: 'Cc', exact: true }).click();
      await recipientInput(page, 'Cc').fill(zed);
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Bcc', exact: true }).click();
      await recipientInput(page, 'Bcc').fill(ida);
      await page.keyboard.press('Enter');

      await page.getByPlaceholder(/subject/i).fill('Board pack');
      await page.locator('[contenteditable="true"]').last().click();
      await page.keyboard.type('The board pack is attached.');
      await expect(
        page.getByRole('button', { name: 'Signature', exact: true })
      ).toBeVisible();
      await attach(page, {
        name: 'pack.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Agenda and minutes.'),
      });
      await expect(page.getByText('pack.txt')).toBeVisible();
      await page.getByRole('button', { name: 'Send email' }).click();
      await expect(notice(page, 'Email sent')).toBeVisible();

      // Every recipient gets one copy, with the file and the signature.
      for (const address of [grace, zed, ida]) {
        await expect
          .poll(
            async () =>
              (await readMailbox(mailbox, address)).map((message) => ({
                subject: message.subject,
                attachments: message.attachments,
              })),
            { message: `${address} never got the message` }
          )
          .toEqual([{ subject: 'Board pack', attachments: ['pack.txt'] }]);
        const [copy] = await readMailbox(mailbox, address);
        expect(copy.to).toEqual([grace]);
        expect(copy.cc).toEqual([zed]);
        // Nobody's copy names the Bcc recipient.
        expect(copy.bcc).toEqual([]);
        expect(copy.html).toContain('The board pack is attached.');
        expect(copy.html).toContain('Ada Lovelace, Analytical Engines');
      }

      // The sender's copy, in Sent, keeps the Bcc.
      const sent = (await readMailbox(mailbox, mailbox.inbox.email)).filter(
        (message) => message.subject === 'Board pack'
      );
      expect(sent).toHaveLength(1);
      expect(sent[0].bcc).toEqual([ida]);
      expect(
        (await mailbox.providerMessages()).find(
          (message) => message.subject === 'Board pack'
        )?.labels
      ).toContain(sentFolder(provider));

      await page
        .getByRole('navigation', { name: 'Email tabs' })
        .getByRole('button', { name: 'Sent' })
        .click();
      await expect(
        page
          .getByRole('grid', { name: 'Email' })
          .getByText('Board pack', { exact: true })
      ).toBeVisible();
    });
  });
}
