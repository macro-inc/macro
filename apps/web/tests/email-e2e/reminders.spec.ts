// Reminders on a thread: set from the list and from the open thread, changed
// and removed from the Reminders tab, listed there, and cancelled by a reply.
// Each for a Gmail and an Outlook inbox.

import type { Page } from '@playwright/test';
import { expect, type Mailbox, test } from './harness/fixtures';
import { focusRow, rowIds } from './harness/list';
import {
  followup,
  pendingFollowups,
  setFollowup,
  tickReminders,
} from './harness/organise';
import { confirmed, did, saw } from './ledger/record';

const from = 'Grace <grace@example.com>';

/** The row of a thread in the list. */
function row(page: Page, threadId: string) {
  return page.locator(`[data-soup-entity] [data-entity-id="${threadId}"]`);
}

function tab(page: Page, name: string) {
  return page
    .getByRole('navigation', { name: 'Email tabs' })
    .getByRole('button', { name });
}

/** The time field of the Remind me menu. */
function remindWhen(page: Page) {
  return page.getByRole('combobox', { name: 'Remind me when' });
}

/** Nine in the morning, `days` days from now, as the app's presets mean it. */
function nineIn(days: number): Date {
  const at = new Date();
  at.setDate(at.getDate() + days);
  at.setHours(9, 0, 0, 0);
  return at;
}

/** When the storage service will bring the thread back, in milliseconds. */
async function remindAt(mailbox: Mailbox, threadId: string): Promise<number> {
  return new Date((await followup(mailbox, threadId))?.remindAt ?? 0).getTime();
}

for (const provider of ['GMAIL', 'OUTLOOK'] as const) {
  test.describe(`reminders on a ${provider} inbox`, () => {
    test.use({ provider });

    // Fails when the h key no longer opens Remind me on a row, when a typed
    // time is not understood or not saved with "if no reply", when the thread
    // stays in the Inbox, or when the Reminders tab does not list it.
    test('a typed reminder set from the list moves the thread to the Reminders tab', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Lunch?', text: 'Noon?' });
      await mailbox.deliver({ from, subject: 'Minutes', text: 'Attached.' });
      const thread = await mailbox.synced('Lunch?');
      await mailbox.synced('Minutes');
      await mailbox.open();

      await focusRow(page, thread.id);
      await page.keyboard.press('h');
      did('AL-071');
      await expect(remindWhen(page)).toBeVisible();
      await expect(
        page.getByRole('option', { name: /^Tomorrow/ })
      ).toBeVisible();
      await expect(
        page.getByRole('option', { name: /^Next week/ })
      ).toBeVisible();
      saw('STL-101');
      await expect(
        page.getByRole('radio', { name: 'If no reply' })
      ).toBeChecked();
      saw('STL-102');

      await remindWhen(page).fill('tomorrow 9am');
      did('AL-621');
      await expect(
        page.getByRole('option', { name: /^tomorrow 9am/ })
      ).toBeVisible();
      await remindWhen(page).press('Enter');
      await expect(remindWhen(page)).toBeHidden();
      // The thread waits out of the Inbox until the reminder returns it.
      await expect.poll(() => rowIds(page)).not.toContain(thread.id);
      await expect
        .poll(() => followup(mailbox, thread.id))
        .toMatchObject({ state: 'pending', condition: 'if_no_reply' });
      expect(await remindAt(mailbox, thread.id)).toBe(nineIn(1).getTime());
      confirmed('F-090');

      await tab(page, 'Reminders').click();
      did('AL-002', 'F-092');
      await expect(
        row(page, thread.id).getByRole('button', {
          name: /^Returning: .* at 9:00 AM if no reply$/,
        })
      ).toBeVisible();
      saw('STL-032');
      // Only the thread with a reminder is listed there.
      await expect.poll(() => rowIds(page)).toEqual([thread.id]);
      expect(
        (await pendingFollowups(mailbox)).map(({ threadId }) => threadId)
      ).toEqual([thread.id]);
      confirmed('F-092');
    });

    // Fails when the header's bell no longer opens Remind me, when the
    // condition or the preset picked there is not what is saved, or when the
    // bell does not show that a reminder is set.
    test('a reminder set from the open thread, regardless of a reply, shows on its bell', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Lunch?', text: 'Noon?' });
      const thread = await mailbox.synced('Lunch?');
      await mailbox.open(`/app/mail/${thread.id}`);
      await expect(page.getByText('Noon?')).toBeVisible();

      await page.getByRole('button', { name: 'Remind me' }).click();
      did('AL-128');
      await expect(remindWhen(page)).toBeVisible();
      await page
        .getByRole('radiogroup', { name: 'Reminder condition' })
        .getByText('Regardless')
        .click();
      did('AL-187');
      await expect(
        page.getByRole('radio', { name: 'Regardless' })
      ).toBeChecked();
      await page.getByRole('option', { name: /^Tomorrow/ }).click();
      did('AL-186');
      await expect(remindWhen(page)).toBeHidden();

      await expect(
        page.getByRole('button', { name: /^Reminder set for .*9:00/ })
      ).toBeVisible();
      saw('STL-104');
      await expect
        .poll(() => followup(mailbox, thread.id))
        .toMatchObject({ state: 'pending', condition: 'regardless' });
      expect(await remindAt(mailbox, thread.id)).toBe(nineIn(1).getTime());
      confirmed('F-090');
    });

    // Fails when the clock on a Reminders row no longer opens the reminder,
    // when picking another time does not move it, or when Remove reminder
    // leaves the reminder standing or the thread in the tab.
    test('a reminder is moved to another time, then removed, from the Reminders tab', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Lunch?', text: 'Noon?' });
      const thread = await mailbox.synced('Lunch?');
      const first = nineIn(3);
      first.setHours(15);
      await setFollowup(mailbox, thread.id, first, 'regardless');
      await mailbox.open();
      await tab(page, 'Reminders').click();
      const clock = row(page, thread.id).getByRole('button', {
        name: /^Returning: /,
      });
      await expect(clock).toHaveAccessibleName(/ at 3:00 PM$/);

      await clock.click();
      did('AL-098');
      await expect(
        page.getByText(/^Scheduled for .* at 3:00 PM$/)
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Remove reminder' })
      ).toBeVisible();
      saw('STL-624');
      await page.getByRole('option', { name: /^Next week/ }).click();
      await expect(remindWhen(page)).toBeHidden();
      await expect(clock).toHaveAccessibleName(/ at 9:00 AM$/);
      await expect
        .poll(() => remindAt(mailbox, thread.id))
        .not.toBe(first.getTime());
      const moved = await followup(mailbox, thread.id);
      expect(moved).toMatchObject({
        state: 'pending',
        condition: 'regardless',
      });
      expect(new Date(moved?.remindAt ?? 0).getHours()).toBe(9);

      await clock.click();
      await page.getByRole('button', { name: 'Remove reminder' }).click();
      did('AL-188');
      await expect(
        page.getByRole('heading', { name: 'No email reminders' })
      ).toBeVisible();
      saw('STL-014', 'F-092');
      await expect
        .poll(async () => (await followup(mailbox, thread.id))?.state)
        .toBe('removed');
      expect(await pendingFollowups(mailbox)).toEqual([]);
      confirmed('F-091');
    });

    // Fails when a reply on the thread leaves its "if no reply" reminder
    // pending: the thread would still be listed under Reminders and come
    // back a second time when the reminder is due.
    test('a reply cancels a reminder set for when there is no reply', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from,
        subject: 'Lunch?',
        text: 'Noon?',
        messageId: 'lunch-1@example.com',
      });
      const thread = await mailbox.synced('Lunch?');
      await setFollowup(mailbox, thread.id, nineIn(1), 'if_no_reply');
      await mailbox.open();
      await tab(page, 'Reminders').click();
      await expect(
        row(page, thread.id).getByRole('button', {
          name: /^Returning: .* if no reply$/,
        })
      ).toBeVisible();

      await mailbox.deliver({
        from,
        subject: 'Re: Lunch?',
        text: 'Still on?',
        messageId: 'lunch-2@example.com',
        inReplyTo: 'lunch-1@example.com',
      });
      await mailbox.synced('Re: Lunch?');
      // The storage service looks at pending reminders on the scheduler's
      // tick, which the test plays.
      await tickReminders(mailbox);
      await expect
        .poll(async () => (await followup(mailbox, thread.id))?.state)
        .toBe('cancelled');
      expect(await pendingFollowups(mailbox)).toEqual([]);
      confirmed('F-094');

      // The tab reads its list again when it is opened.
      await tab(page, 'Inbox').click();
      await expect(row(page, thread.id)).toBeVisible();
      await tab(page, 'Reminders').click();
      await expect(
        page.getByRole('heading', { name: 'No email reminders' })
      ).toBeVisible();
      await expect(row(page, thread.id)).toBeHidden();
      saw('STL-908');
    });
  });
}
