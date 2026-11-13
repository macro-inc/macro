// Where a thread is listed besides the inbox: Sent across linked inboxes, and
// the folder a thread was moved to.

import { expect, test } from './harness/fixtures';
import { focusRow, rowIds } from './harness/list';

test.describe('the Sent view', () => {
  // Class sent-view-only-primary-inbox: when this fails, Sent lists only what
  // was sent from the account's primary address, and mail sent from another
  // linked inbox is missing from it.
  test('lists mail sent from every linked inbox', async ({ page, mailbox }) => {
    const side = await mailbox.stack.link(
      mailbox.user,
      'GMAIL',
      'ada.side@example.com'
    );
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'To the main address',
      text: 'Main question?',
    });
    await mailbox.stack.deliver(side.email, {
      from: 'Grace <grace@example.com>',
      subject: 'To the side address',
      text: 'Side question?',
    });
    const mainThread = await mailbox.synced('To the main address');
    let sideThreadId = '';
    await expect
      .poll(
        async () => {
          const response = await mailbox.api(
            '/email/email/threads/previews/cursor/all?limit=100',
            { headers: { 'x-email-link-id': side.linkId } }
          );
          const body = (await response.json()) as {
            items: { id: string; name: string }[];
          };
          sideThreadId =
            body.items.find((item) => item.name === 'To the side address')
              ?.id ?? '';
          return sideThreadId;
        },
        { timeout: 60_000 }
      )
      .not.toBe('');

    const answers = [
      {
        threadId: mainThread.id,
        text: 'Main answer',
        from: mailbox.inbox.email,
      },
      { threadId: sideThreadId, text: 'Side answer', from: side.email },
    ];
    for (const answer of answers) {
      await mailbox.open(`/app/mail/${answer.threadId}`);
      await page.getByText('Reply...').click();
      await page.keyboard.type(answer.text);
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect
        .poll(async () =>
          (await mailbox.stack.providerMessages(answer.from)).some(
            (message) =>
              message.labels.includes('SENT') &&
              message.from?.includes(answer.from)
          )
        )
        .toBe(true);
    }

    await mailbox.open('/app/mail');
    await page.getByText('Sent', { exact: true }).click();
    await expect(page).toHaveURL(/tab=sent/);
    const list = page.getByRole('grid', { name: 'Email' });
    await expect(list.getByText('Main answer')).toBeVisible();
    await expect(list.getByText('Side answer')).toBeVisible();
  });
});

test.describe('moving a thread to a folder', () => {
  // Class labels-move-to-folder-wrong: when this fails, a thread moved to a
  // folder is not listed in that folder (the move looked done, the folder is
  // empty), or stops being listed there once it is archived out of the inbox.
  test('the folder lists the moved thread, also once it is archived', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Contract draft',
      text: 'The contract is attached.',
    });
    const contract = await mailbox.synced('Contract draft');
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Lunch on Friday',
      text: 'Are you free?',
    });
    await mailbox.synced('Lunch on Friday');

    await mailbox.open('/app/mail');
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

    // The folder holds the moved thread and not the other one.
    await expect(page).not.toHaveURL(/\/app\/mail/);
    await expect(page.getByText('Contract draft')).toBeVisible();
    await expect(page.getByText('Lunch on Friday')).toHaveCount(0);
    const folder = new URL(page.url());

    await mailbox.open('/app/mail');
    await focusRow(page, contract.id);
    await page.keyboard.press('e');
    await expect.poll(() => rowIds(page)).not.toContain(contract.id);
    await expect
      .poll(
        async () =>
          (await mailbox.providerMessages()).find(
            (message) => message.subject === 'Contract draft'
          )?.inInbox
      )
      .toBe(false);

    await mailbox.open(folder.pathname + folder.search);
    await expect(page.getByText('Contract draft')).toBeVisible();
  });
});
