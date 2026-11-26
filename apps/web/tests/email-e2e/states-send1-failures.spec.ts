// What a desktop composer says when a send time cannot be held: the service
// refuses the schedule, its time has passed, the draft was never saved, Undo
// of a schedule is refused, comes after the message went out, or cannot
// reopen the draft on this device, and a move to a new time is refused. Each
// for a Gmail and an Outlook inbox.

import type { Page } from '@playwright/test';
import { composeNew, loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { notice, sentMessages } from './harness/send';
import type { Provider } from './harness/stack';
import {
  draftStorage,
  operation,
  refuse,
  scheduleRequest,
} from './harness/states-send1';
import {
  clock,
  morningIn,
  openPicker,
  preset,
  scheduled,
  scheduledClock,
  scheduledNotice,
  scheduledTimes,
} from './harness/ways-send';
import { saw } from './ledger/record';

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

/** A new message to grace with a time tomorrow chosen, not yet scheduled. */
async function chooseTomorrow(
  page: Page,
  mailbox: Mailbox,
  subject: string
): Promise<void> {
  await composeNew(page, mailbox, {
    to: 'grace@example.com',
    subject,
    body: 'The numbers are in.',
  });
  await openPicker(page, clock(page));
  await preset(page, 'Tomorrow').click();
}

function scheduleSend(page: Page) {
  return page
    .getByRole('button', { name: 'Schedule send', exact: true })
    .click();
}

for (const provider of PROVIDERS) {
  test.describe(`what the composer says when a send time cannot be held, ${provider === 'GMAIL' ? 'Gmail' : 'Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a schedule that did not take is silent or looks
    // held: the user is not told the service refused it, that Undo came
    // after the message had gone out or could not reopen the draft, or that
    // the chosen time has passed, and believes a message is waiting that is
    // not (or is gone that is), or looks for a draft that is not open.
    test('a refused schedule, an Undo after the message went out, a draft not reopened and a time gone by say so', async ({
      page,
      mailbox,
    }) => {
      const storage = await draftStorage(page);
      await chooseTomorrow(page, mailbox, 'Quarterly');
      const refused = await refuse(page, scheduleRequest('PUT'));
      await scheduleSend(page);
      await expect(notice(page, 'Failed to schedule email')).toBeVisible();
      saw('STC-062');
      expect(refused()).toBe(1);
      expect(await scheduled(mailbox)).toEqual([]);

      // Scheduled now, then delivered before Undo is pressed.
      await scheduleSend(page);
      const held = scheduledNotice(page);
      await expect(held).toBeVisible({ timeout: 30_000 });
      // The notice stays while the pointer rests on it.
      await held.hover();
      await expect.poll(async () => (await scheduled(mailbox)).length).toBe(1);
      const [message] = await scheduled(mailbox);
      const due = await mailbox.stack.sql(
        `UPDATE email_scheduled_messages SET send_time = now()
         WHERE message_id = '${message.db_id}' AND link_id = '${mailbox.inbox.linkId}'
         RETURNING message_id`
      );
      expect(due).toHaveLength(1);
      await mailbox.stack.runScheduledSweep();
      await expect
        .poll(async () => (await sentMessages(mailbox)).length, {
          timeout: 30_000,
        })
        .toBe(1);
      // The service records it sent a moment after the provider has it;
      // until then an Undo finds it still being delivered.
      await expect
        .poll(
          async () =>
            (
              await mailbox.stack.sql(
                `SELECT id FROM email_messages WHERE id = '${message.db_id}' AND is_sent`
              )
            ).length,
          { timeout: 30_000 }
        )
        .toBe(1);
      await held.getByRole('button', { name: 'Undo' }).click();
      await expect(
        notice(
          page,
          'This email was already sent and can no longer be unscheduled.'
        )
      ).toBeVisible();
      saw('STC-067');

      // Scheduled again; Undo takes the time away, but this device can no
      // longer write the draft back for editing.
      await chooseTomorrow(page, mailbox, 'Reopen');
      await scheduleSend(page);
      await expect(held).toBeVisible({ timeout: 30_000 });
      await held.hover();
      await expect.poll(async () => (await scheduled(mailbox)).length).toBe(1);
      await storage.failWrites();
      await held.getByRole('button', { name: 'Undo' }).click();
      await expect(
        notice(
          page,
          'Schedule cancelled, but the draft could not be reopened. Check Drafts.'
        )
      ).toBeVisible();
      saw('STC-066');
      await storage.release();
      expect(await scheduled(mailbox)).toEqual([]);

      // A time chosen, then the clock passes it before Schedule send.
      await chooseTomorrow(page, mailbox, 'Too late');
      await page.clock.setSystemTime(Date.now() + 3 * 24 * 60 * 60 * 1000);
      await scheduleSend(page);
      await expect(
        notice(page, 'That send time has passed. Choose a future time.')
      ).toBeVisible();
      saw('STC-061');
    });

    // When this fails, a schedule the service would not take back, or would
    // not move, is reported as done or not at all: the user believes the
    // message is back in their hands, or held for the new time, when it
    // still goes at the old one; or a draft the service never saved is
    // handed to Schedule send.
    test('a refused Undo, a refused move and an unsaved draft say the schedule stands or cannot start', async ({
      page,
      mailbox,
    }) => {
      await chooseTomorrow(page, mailbox, 'Offsite');
      await scheduleSend(page);
      const held = scheduledNotice(page);
      await expect(held).toBeVisible({ timeout: 30_000 });
      await held.hover();
      await expect.poll(async () => (await scheduled(mailbox)).length).toBe(1);
      await refuse(page, scheduleRequest('DELETE'), 3);
      await held.getByRole('button', { name: 'Undo' }).click();
      await expect(notice(page, 'Failed to undo scheduled send')).toBeVisible();
      saw('STC-068');
      expect(await scheduled(mailbox)).toHaveLength(1);

      await page
        .getByRole('navigation', { name: 'Email tabs' })
        .getByRole('button', { name: 'Scheduled' })
        .click();
      await page.getByRole('main').getByText('Offsite').click();
      await openPicker(page, scheduledClock(page));
      await preset(page, 'In 2 days').click();
      await refuse(page, scheduleRequest('PUT'));
      await page
        .getByRole('button', { name: 'Update schedule', exact: true })
        .click();
      await expect(notice(page, 'Failed to update schedule')).toBeVisible();
      saw('STC-405');
      // Still held for the first time, tomorrow morning.
      expect(await scheduledTimes(mailbox)).toEqual([morningIn(1).toString()]);

      // The service refuses every save of a new message.
      await refuse(page, operation('SaveEmailDraft'), 1_000);
      await chooseTomorrow(page, mailbox, 'Never saved');
      await scheduleSend(page);
      const unsaved = notice(page, 'Failed to schedule email');
      await expect(unsaved).toContainText(
        'Draft is not ready to schedule. Resolve any save or connection errors and try again'
      );
      saw('STC-063', 'F-142');
    });
  });
}
