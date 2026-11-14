// Journey: scheduling a new message from the composer, finding it under
// Scheduled, moving its time, cancelling it, scheduling it again and letting
// it go out when its time comes.

import type { Page } from '@playwright/test';
import { composeNew, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { addMailbox, readMailbox, sentFolder } from './harness/journeys';
import { notice } from './harness/send';
import type { Provider } from './harness/stack';
import { confirmed, did, saw } from './ledger/record';

type Scheduled = { db_id: string; scheduled_send_time: string };

/** Picks a send time in the composer's clock, by the words a user types. */
async function pickSendTime(
  page: Page,
  clock: RegExp,
  words: string
): Promise<void> {
  await page.getByRole('button', { name: clock }).click();
  await page.getByRole('combobox', { name: /./ }).last().fill(words);
  await page.getByRole('option').first().click();
  did('AC-046');
}

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`scheduled send from ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a scheduled message goes out at the wrong time or at
    // once, a new time or a cancel is ignored, or it never goes out.
    test('schedule, reschedule, cancel, schedule again; it goes out when due', async ({
      page,
      mailbox,
    }) => {
      const grace = 'grace@example.com';
      await addMailbox(mailbox, grace);
      const scheduled = async () => {
        const response = await mailbox.api(
          '/email/email/drafts/scheduled?offset=0&limit=100'
        );
        const body = (await response.json()) as { messages: Scheduled[] };
        return body.messages;
      };
      const tabs = page.getByRole('navigation', { name: 'Email tabs' });
      // By its name: "Email scheduled for …" can show beside it when the
      // composer reads the schedule back before its own request returns.
      const scheduledNotice = page.getByRole('status', {
        name: 'Email scheduled',
        exact: true,
      });

      await composeNew(page, mailbox, {
        to: grace,
        subject: 'Quarterly numbers',
        body: 'The numbers are in.',
      });
      await pickSendTime(page, /^Choose send time/, 'tomorrow 9am');
      await page
        .getByRole('button', { name: 'Schedule send', exact: true })
        .click();
      did('AC-049');
      await expect(scheduledNotice).toBeVisible();
      saw('STC-059');

      // Macro holds it for tomorrow; nothing has reached Grace.
      await expect.poll(async () => (await scheduled()).length).toBe(1);
      confirmed('F-145');
      const [first] = await scheduled();
      expect(new Date(first.scheduled_send_time).getHours()).toBe(9);
      confirmed('F-142');
      expect(await readMailbox(mailbox, grace)).toEqual([]);

      await tabs.getByRole('button', { name: 'Scheduled' }).click();
      did('AL-002', 'F-145');
      const list = page.getByRole('main');
      await expect(list.getByText('Quarterly numbers')).toBeVisible();

      // Rescheduled from its thread: Macro holds the new time.
      await list.getByText('Quarterly numbers').click();
      did('AL-050');
      await pickSendTime(page, /^Scheduled for /, 'in 2 weeks');
      await page
        .getByRole('button', { name: 'Update schedule', exact: true })
        .click();
      did('AC-050');
      await expect(notice(page, 'Email rescheduled')).toBeVisible();
      saw('STC-404');
      await expect
        .poll(async () => (await scheduled())[0]?.scheduled_send_time)
        .not.toBe(first.scheduled_send_time);
      const moved = new Date((await scheduled())[0].scheduled_send_time);
      expect(moved.getTime() - Date.now()).toBeGreaterThan(13 * 24 * 3600_000);
      confirmed('F-143');

      // Cancelled: back to an editable draft, gone from Scheduled.
      // The Send button's tooltip covers the bar while the pointer rests on it.
      await page.mouse.move(0, 0);
      await page.getByRole('button', { name: 'Cancel scheduled send' }).click();
      did('AC-052');
      await expect(
        notice(page, 'Schedule cancelled. This email is editable again.')
      ).toBeVisible();
      saw('STC-070');
      await expect.poll(scheduled).toEqual([]);
      confirmed('F-144');
      await tabs.getByRole('button', { name: 'Scheduled' }).click();
      did('AL-002', 'F-145');
      await expect(page.getByText('No scheduled email')).toBeVisible();
      saw('STL-013', 'F-145');

      // Scheduled again from the draft, then its time comes.
      await tabs.getByRole('button', { name: 'Drafts' }).click();
      did('AL-002', 'F-030');
      await page.getByRole('main').getByText('Quarterly numbers').click();
      did('AL-050');
      await pickSendTime(page, /^Choose send time/, 'tomorrow 9am');
      await page
        .getByRole('button', { name: 'Schedule send', exact: true })
        .click();
      did('AC-049');
      await expect(scheduledNotice).toBeVisible();
      saw('STC-059');
      await expect.poll(async () => (await scheduled()).length).toBe(1);
      confirmed('F-142');
      expect(await readMailbox(mailbox, grace)).toEqual([]);
      // Nothing went out early in all that time: the provider's Sent is empty.
      expect(
        (await mailbox.providerMessages()).filter(
          (message) =>
            message.subject === 'Quarterly numbers' &&
            message.labels.includes(sentFolder(provider))
        )
      ).toEqual([]);

      const [again] = await scheduled();
      const due = await mailbox.stack.sql(
        `UPDATE email_scheduled_messages SET send_time = now() - interval '1 second'
         WHERE message_id = '${again.db_id}' AND link_id = '${mailbox.inbox.linkId}'
         RETURNING message_id`
      );
      expect(due).toHaveLength(1);
      await mailbox.stack.runScheduledSweep();

      await expect
        .poll(
          async () =>
            (await readMailbox(mailbox, grace)).map((message) => ({
              subject: message.subject,
              from: message.from,
            })),
          { timeout: 60_000 }
        )
        .toEqual([{ subject: 'Quarterly numbers', from: mailbox.inbox.email }]);
      const [received] = await readMailbox(mailbox, grace);
      expect(received.html).toContain('The numbers are in.');
      expect(
        (await mailbox.providerMessages())
          .filter((message) => message.labels.includes(sentFolder(provider)))
          .map((message) => message.subject)
      ).toEqual(['Quarterly numbers']);
      confirmed('F-146');
      await expect.poll(scheduled).toEqual([]);
    });
  });
}
