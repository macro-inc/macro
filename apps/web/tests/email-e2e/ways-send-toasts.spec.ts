// The ways in that sit on the schedule notices and the schedule bar of a
// message Macro already holds: Undo and View message on the corner notice,
// and the bar's Cancel change for a proposed new time.

import { composeNew, draftThreads, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { notice, sentMessages } from './harness/send';
import type { Provider } from './harness/stack';
import {
  barButton,
  clock,
  morningIn,
  openPicker,
  preset,
  scheduledClock,
  scheduledNotice,
  scheduledTimes,
} from './harness/ways-send';
import { confirmed, did, saw } from './ledger/record';

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`the schedule notices in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Undo on "Email scheduled" leaves the message held for
    // later, View message on either notice does not open the message, or
    // the bar's Cancel change moves the send time anyway.
    test('Undo takes the schedule back, View message opens it, Cancel change keeps its time', async ({
      page,
      mailbox,
    }) => {
      const inbox = page
        .getByRole('navigation', { name: 'Email tabs' })
        .getByRole('button', { name: 'Inbox' });
      const schedule = async (subject: string) => {
        await composeNew(page, mailbox, {
          to: 'grace@example.com',
          subject,
          body: 'The numbers are in.',
        });
        await openPicker(page, clock(page));
        await preset(page, 'Tomorrow').click();
        await page
          .getByRole('button', { name: 'Schedule send', exact: true })
          .click();
        await expect(scheduledNotice(page)).toBeVisible();
        saw('STC-059');
        // A notice goes after eight seconds unless the pointer rests on it.
        await scheduledNotice(page).hover();
      };
      const tomorrow = morningIn(1).toString();

      // Undo: Macro no longer holds it to send; it is a draft again.
      await schedule('Taken back');
      await expect.poll(() => scheduledTimes(mailbox)).toEqual([tomorrow]);
      await scheduledNotice(page).getByRole('button', { name: 'Undo' }).click();
      did('AC-055');
      // Exactly: not the notice of a schedule cancelled from the composer.
      await expect(notice(page, /^Schedule cancelled\.$/)).toBeVisible();
      saw('STC-065');
      await expect.poll(() => scheduledTimes(mailbox)).toEqual([]);
      await expect
        .poll(async () =>
          (await draftThreads(mailbox)).map((thread) => thread.name)
        )
        .toEqual(['Taken back']);
      confirmed('F-144');

      // View message, from somewhere else: the scheduled message opens.
      await schedule('Kept');
      await expect.poll(() => scheduledTimes(mailbox)).toEqual([tomorrow]);
      await expect(page).toHaveURL(/\/app\/mail\/[0-9a-f-]{36}$/);
      const message = page.url();
      await inbox.click();
      await scheduledNotice(page).hover();
      await expect(page).not.toHaveURL(message);
      await scheduledNotice(page)
        .getByRole('button', { name: 'View message' })
        .click();
      did('AC-056', 'F-142');
      await expect(page).toHaveURL(message);
      await expect(scheduledClock(page)).toBeVisible();
      confirmed('F-142');

      // A new time proposed and given up: Macro still holds the first one.
      await openPicker(page, scheduledClock(page));
      await preset(page, 'In 2 days').click();
      const update = page.getByRole('button', {
        name: 'Update schedule',
        exact: true,
      });
      await expect(update).toBeVisible();
      await (await barButton(page, 'Cancel schedule change')).click();
      did('AC-051');
      await expect(update).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: /^Scheduled for / })
      ).toBeVisible();
      expect(await scheduledTimes(mailbox)).toEqual([tomorrow]);

      // Proposed again and confirmed; View message on that notice opens it.
      await openPicker(page, scheduledClock(page));
      await preset(page, 'In 2 days').click();
      await update.click();
      const rescheduled = notice(page, 'Email rescheduled');
      await expect(rescheduled).toBeVisible();
      saw('STC-404');
      await rescheduled.hover();
      await expect
        .poll(() => scheduledTimes(mailbox))
        .toEqual([morningIn(2).toString()]);
      await inbox.click();
      await rescheduled.hover();
      await expect(page).not.toHaveURL(message);
      await rescheduled.getByRole('button', { name: 'View message' }).click();
      did('AC-056', 'F-143');
      await expect(page).toHaveURL(message);
      await expect(scheduledClock(page)).toBeVisible();
      confirmed('F-143');
      expect(await sentMessages(mailbox)).toEqual([]);
    });
  });
}
