// Journey: a day of mail in one inbox. The list, a thread opened, answered
// and forwarded, a new message drafted, reloaded and thrown away, a thread
// marked done and taken back, another filed in a folder. The same journey
// for a Gmail and an Outlook inbox; what each provider then holds is checked
// through its own API.

import {
  composeNew,
  discardButton,
  draftThreads,
  loadAppSteadily,
  routeDraftId,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { addMailbox, readMailbox, sentFolder } from './harness/journeys';
import { focusRow, rowIds } from './harness/list';
import { notice, replyEditor } from './harness/send';
import type { Provider } from './harness/stack';

const PROVIDERS: Provider[] = ['OUTLOOK', 'GMAIL'];

for (const provider of PROVIDERS) {
  test.describe(`a day of mail in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a step of an ordinary day does not reach the provider:
    // a reply or forward goes missing or loses the quote, a draft is lost or
    // not deleted, Done or its undo stays in Macro, or filing loses the thread.
    test('list, open, reply, forward, draft and discard, done and undo, file in a folder', async ({
      page,
      mailbox,
    }) => {
      const grace = 'grace@example.com';
      const zed = 'zed@example.com';
      await addMailbox(mailbox, grace);
      await addMailbox(mailbox, zed);
      await mailbox.deliver({
        from: `Grace <${grace}>`,
        subject: 'Lunch?',
        text: 'Noon at the usual place?',
      });
      await mailbox.deliver({
        from: 'Ida <ida@example.com>',
        subject: 'Weekly report',
        text: 'This week in numbers.',
      });
      await mailbox.deliver({
        from: 'Ida <ida@example.com>',
        subject: 'Contract draft',
        text: 'The contract is attached.',
      });
      await mailbox.synced('Lunch?');
      const report = await mailbox.synced('Weekly report');
      const contract = await mailbox.synced('Contract draft');
      const held = async (subject: string) =>
        (await mailbox.providerMessages()).find(
          (message) => message.subject === subject
        );

      // The list shows the inbox.
      await mailbox.open();
      const list = page.getByRole('grid', { name: 'Email' });
      for (const subject of ['Lunch?', 'Weekly report', 'Contract draft']) {
        await expect(list.getByText(subject)).toBeVisible();
      }

      // Open a thread and reply: Grace gets the answer in her conversation.
      await list.getByText('Lunch?').click();
      await expect(page.getByText('Noon at the usual place?')).toBeVisible();
      await page.getByText('Reply...').click();
      await replyEditor(page).pressSequentially('Works for me.');
      await page.getByRole('button', { name: 'Send email' }).click();
      await expect(notice(page, 'Email sent')).toBeVisible();
      await expect
        .poll(async () =>
          (await readMailbox(mailbox, grace)).map((message) => message.subject)
        )
        .toEqual(['Re: Lunch?']);
      const [reply] = await readMailbox(mailbox, grace);
      expect(reply.html).toContain('Works for me.');
      const original = await held('Lunch?');
      const answer = (await mailbox.providerMessages()).find(
        (message) =>
          message.subject === 'Re: Lunch?' &&
          message.labels.includes(sentFolder(provider))
      );
      expect(answer?.threadId).toBe(original?.threadId);

      // Forward Grace's message to Zed: it is folded under the reply, so it is
      // opened first, and its Forward is the thread's first.
      await page.getByText('Noon at the usual place?').first().click();
      await page.getByText('Noon at the usual place?').first().hover();
      await page
        .getByRole('button', { name: 'Forward', exact: true })
        .first()
        .click();
      await page.getByRole('combobox').fill(zed);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('link', { name: zed })).toBeVisible();
      await replyEditor(page).click();
      await replyEditor(page).pressSequentially('See below.');
      await page.getByRole('button', { name: 'Send email' }).click();
      await expect
        .poll(async () =>
          (await readMailbox(mailbox, zed)).map((message) => message.subject)
        )
        .toEqual(['Fwd: Lunch?']);
      const [forwarded] = await readMailbox(mailbox, zed);
      expect(forwarded.html).toContain('See below.');
      expect(forwarded.html).toContain('Noon at the usual place?');

      // A new message is saved as a draft, survives a reload, and is thrown
      // away: Macro lets go of it, and so does Outlook, where Macro writes its
      // drafts into the mailbox (a Gmail inbox's drafts stay in Macro).
      await composeNew(page, mailbox, {
        to: zed,
        subject: 'Offsite plan',
        body: 'Thinking of the coast.',
      });
      await routeDraftId(page);
      await expect
        .poll(async () =>
          (await draftThreads(mailbox)).map((thread) => thread.name)
        )
        .toEqual(['Offsite plan']);
      if (provider === 'OUTLOOK') {
        await expect
          .poll(async () => (await held('Offsite plan')) !== undefined)
          .toBe(true);
      }
      await page.reload();
      await expect(page.getByPlaceholder(/subject/i)).toHaveValue(
        'Offsite plan'
      );
      await expect(page.getByText('Thinking of the coast.')).toBeVisible();
      await discardButton(page).click();
      await expect.poll(() => draftThreads(mailbox)).toEqual([]);
      await expect.poll(() => held('Offsite plan')).toBeUndefined();

      // Done, and taken back with undo.
      await mailbox.open();
      await focusRow(page, report.id);
      await page.keyboard.press('e');
      await expect(notice(page, 'Marked as done')).toBeVisible();
      await expect.poll(() => rowIds(page)).not.toContain(report.id);
      await expect
        .poll(async () => (await held('Weekly report'))?.inInbox)
        .toBe(false);
      // The toast's Undo is gone after 3 seconds; z is the same undo.
      await page.keyboard.press('z');
      await expect.poll(() => rowIds(page)).toContain(report.id);
      await expect
        .poll(async () => (await held('Weekly report'))?.inInbox)
        .toBe(true);

      // Filed in a new Macro folder: the folder lists it and not the others.
      await focusRow(page, contract.id);
      await page.keyboard.press('m');
      await page
        .getByRole('combobox', { name: /Search folders/ })
        .fill('Clients 2026');
      await page.keyboard.press('Enter');
      await page
        .getByRole('status')
        .filter({ hasText: 'Moved to folder' })
        .getByRole('button', { name: 'Open', exact: true })
        .click();
      await expect(page.getByText('Contract draft')).toBeVisible();
      await expect(page.getByText('Weekly report')).toHaveCount(0);
    });
  });
}
