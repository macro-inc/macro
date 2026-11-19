// The reply composer's own clock and schedule bar: a reply held for later,
// moved, cancelled back into the reply, and restored after the provider
// refused it at its time.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { injectFault, notice, replyEditor, sentMessages } from './harness/send';
import type { Provider } from './harness/stack';
import {
  barButton,
  clock,
  morningIn,
  openPicker,
  preset,
  scheduled,
  scheduledClock,
  scheduledNotice,
  scheduledTimes,
} from './harness/ways-send';
import { confirmed, did, saw } from './ledger/record';

/** Opens a delivered thread, writes a reply and holds it for tomorrow. */
async function scheduleReply(page: Page, mailbox: Mailbox): Promise<void> {
  await mailbox.deliver({
    from: 'Grace <grace@example.com>',
    subject: 'Lunch?',
    text: 'Noon at the usual place?',
  });
  const thread = await mailbox.synced('Lunch?');
  await mailbox.open(`/app/mail/${thread.id}`);
  did('AL-910');
  await page.getByText('Reply...').click();
  did('AL-171');
  await replyEditor(page).pressSequentially('Works for me.');
  did('AC-081');
  await openPicker(page, clock(page));
  await preset(page, 'Tomorrow').click();
  did('AC-098', 'F-142');
  await page
    .getByRole('button', { name: 'Schedule send', exact: true })
    .click();
  await expect(scheduledNotice(page)).toBeVisible();
  saw('STC-059');
  await expect
    .poll(() => scheduledTimes(mailbox))
    .toEqual([morningIn(1).toString()]);
  confirmed('F-142');
}

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`a reply held for later in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the clock in the reply's footer does not hold the
    // reply for the chosen time or does not move it, or the bar under the
    // reply does not cancel it back into a reply that can be edited.
    test('the reply clock schedules and moves the reply, and the bar under it cancels', async ({
      page,
      mailbox,
    }) => {
      await scheduleReply(page, mailbox);

      await openPicker(page, scheduledClock(page));
      await preset(page, 'In 2 days').click();
      did('AC-098', 'F-143');
      await page
        .getByRole('button', { name: 'Update schedule', exact: true })
        .click();
      await expect(notice(page, 'Email rescheduled')).toBeVisible();
      saw('STC-404');
      await expect
        .poll(() => scheduledTimes(mailbox))
        .toEqual([morningIn(2).toString()]);
      confirmed('F-143');

      await (await barButton(page, 'Cancel scheduled send')).click();
      did('AC-099', 'F-144');
      await expect(
        notice(page, 'Schedule cancelled. This email is editable again.')
      ).toBeVisible();
      saw('STC-070');
      await expect.poll(() => scheduledTimes(mailbox)).toEqual([]);
      confirmed('F-144');
      await expect(replyEditor(page)).toHaveText('Works for me.');
      await expect(clock(page)).toBeEnabled();
      expect(await sentMessages(mailbox)).toEqual([]);
    });
  });
}

test.describe('a scheduled reply the provider refuses', () => {
  // Gmail only: scheduled-failure.spec.ts covers the Outlook recovery notice
  // and cancellation.
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a reply that failed at its time cannot be taken back
  // from the bar under the reply: it stays locked, or is lost.
  test('is restored into the reply from the bar under it', async ({
    page,
    mailbox,
  }) => {
    // The wait for the failure below takes up to a minute of its own.
    test.setTimeout(180_000);
    await scheduleReply(page, mailbox);
    const [held] = await scheduled(mailbox);
    await injectFault(mailbox, { route: 'messages.send', error: 'forbidden' });
    const due = await mailbox.stack.sql(
      `UPDATE email_scheduled_messages SET send_time = now() - interval '1 second'
       WHERE message_id = '${held.db_id}' AND link_id = '${mailbox.inbox.linkId}'
       RETURNING message_id`
    );
    expect(due).toHaveLength(1);
    await mailbox.stack.runScheduledSweep();

    // The open reply hears of the failure from its schedule's next read,
    // every 30 seconds while the send time it knows is far off.
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Send failed before delivery' })
    ).toBeVisible({ timeout: 60_000 });
    saw('STC-057');
    await (await barButton(page, 'Restore failed scheduled draft')).click();
    did('AC-099', 'F-147');
    await expect(
      notice(page, 'Schedule cancelled. This email is editable again.')
    ).toBeVisible();
    await expect.poll(() => scheduled(mailbox)).toEqual([]);
    await expect(replyEditor(page)).toHaveText('Works for me.');
    await expect(clock(page)).toBeEnabled();
    expect(await sentMessages(mailbox)).toEqual([]);
    confirmed('F-147');
  });
});
