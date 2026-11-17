import type { Mailbox } from './harness/fixtures';
import { expect, test } from './harness/fixtures';
import { PROVIDERS } from './harness/providers';
import { gmailSaveDraft } from './harness/send';
import { confirmed, saw } from './ledger/record';

/** Saves a draft in the mailbox at the provider, as another mail client does. */
async function saveDraftAtProvider(
  mailbox: Mailbox,
  draft: { to: string; subject: string; text: string }
) {
  if (mailbox.inbox.provider === 'GMAIL') {
    const sent = await mailbox.deliver({
      from: `Linus <${draft.to}>`,
      subject: draft.subject,
      text: 'Where shall we go?',
      messageId: 'offsite-1@example.com',
    });
    await gmailSaveDraft(mailbox, {
      threadId: sent.threadId,
      raw: [
        `From: ${mailbox.inbox.email}`,
        `To: ${draft.to}`,
        `Subject: Re: ${draft.subject}`,
        'In-Reply-To: <offsite-1@example.com>',
        'References: <offsite-1@example.com>',
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset="utf-8"',
        '',
        `<div dir="ltr">${draft.text}</div>`,
      ].join('\r\n'),
    });
    return;
  }
  const response = await fetch(
    `${mailbox.stack.info.outlookUrl}/_emulator/mailboxes/${encodeURIComponent(mailbox.inbox.email)}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        to: draft.to,
        subject: draft.subject,
        html: `<div>${draft.text}</div>`,
        folder: 'drafts',
      }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Outlook refused the draft: ${response.status} ${await response.text()}`
    );
  }
}

/** The snippets of the drafts the email service lists for the user. */
async function draftSnippets(mailbox: Mailbox): Promise<string[]> {
  const response = await mailbox.api(
    '/email/email/threads/previews/cursor/all?limit=100'
  );
  const { items } = (await response.json()) as {
    items: { isDraft: boolean; snippet: string | null }[];
  };
  return items
    .filter((item) => item.isDraft)
    .map((item) => (item.snippet ?? '').trim());
}

for (const provider of PROVIDERS) {
  test.describe(`a draft written at the provider (${provider})`, () => {
    test.use({ provider });

    // Class sync-provider-draft: a draft saved from another mail client must
    // reach the app as a draft. When this fails the draft someone started on
    // their phone is missing from Drafts, or is listed as received mail.
    test('is picked up as a draft and listed in Drafts with its text', async ({
      page,
      mailbox,
    }) => {
      await saveDraftAtProvider(mailbox, {
        to: 'linus@example.com',
        subject: 'Offsite',
        text: 'Thinking of the coast.',
      });

      await expect
        .poll(() => draftSnippets(mailbox), { timeout: 60_000 })
        .toEqual(['Thinking of the coast.']);
      confirmed('F-021');

      await mailbox.open('/app/mail');
      await page
        .getByRole('navigation', { name: 'Email tabs' })
        .getByRole('button', { name: 'Drafts' })
        .click();
      const row = page.getByRole('row').filter({ hasText: 'Offsite' });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Thinking of the coast.');
      await expect(row).toContainText(/draft/i);
      saw('STL-903');
    });
  });
}
