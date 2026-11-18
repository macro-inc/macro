// What a message's calendar card shows when the calendar cannot be asked,
// when the message cancels the event, and when it carries a guest's answer.
// For a Gmail and an Outlook inbox: each provider hands over the event its
// own way.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { cancelFile, replyFile } from './harness/states-thread';
import { calendarFile, deliverCalendarFile } from './harness/ways-thread';
import { saw } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`the calendar card of a message in ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, an invitation shown while the calendar cannot be
    // asked does not say it shows the saved details (or offers no Retry
    // calendar), a cancellation is not marked Cancelled with its time
    // struck through, or a guest's answer does not say who answered what,
    // with their comment.
    test('the calendar down, a cancellation and a guest’s answer', async ({
      page,
      mailbox,
    }) => {
      const invited = await deliverCalendarFile(
        mailbox,
        {
          subject: 'Invitation: Planning review',
          text: 'You have been invited to Planning review.',
        },
        {
          filename: 'invite.ics',
          ics: calendarFile({
            uid: 'planning-review-1@example.com',
            summary: 'Planning review',
          }),
        }
      );
      const cancelled = await deliverCalendarFile(
        mailbox,
        {
          subject: 'Cancelled: Harbour walk',
          text: 'Harbour walk has been cancelled.',
        },
        {
          filename: 'invite.ics',
          ics: cancelFile({
            uid: 'harbour-walk-1@example.com',
            summary: 'Harbour walk',
          }),
        }
      );
      const answered = await deliverCalendarFile(
        mailbox,
        {
          subject: 'Accepted: Budget sync',
          text: 'Bob has accepted this invitation.',
        },
        {
          filename: 'invite.ics',
          ics: replyFile({
            uid: 'budget-sync-1@example.com',
            summary: 'Budget sync',
            guest: 'Bob',
            status: 'ACCEPTED',
            comment: 'See you there.',
          }),
        }
      );
      const card = (title: string) =>
        page.getByRole('region', { name: `Calendar invitation: ${title}` });

      // The calendar cannot be asked until the test lets it.
      let calendarDown = true;
      await page.route(/\/calendar-invitations(\?|$)/, (route) =>
        calendarDown
          ? route.fulfill({ status: 503, body: 'unavailable' })
          : route.fallback()
      );
      await mailbox.open(`/app/mail/${invited}`);
      const review = card('Planning review');
      const unavailable = review.getByText(
        'Calendar unavailable. Showing saved invitation details.'
      );
      await expect(unavailable).toBeVisible({ timeout: 30_000 });
      const retry = review.getByRole('button', { name: 'Retry calendar' });
      await expect(retry).toBeVisible();
      saw('STL-097');
      calendarDown = false;
      await retry.click();
      await expect(unavailable).toHaveCount(0);

      await mailbox.open(`/app/mail/${cancelled}`);
      const walk = card('Harbour walk');
      await expect(walk.getByText('Cancelled', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(walk.locator('p.line-through')).toBeVisible();
      await expect(walk.getByRole('button', { name: 'Yes' })).toHaveCount(0);
      saw('STL-515');

      await mailbox.open(`/app/mail/${answered}`);
      const sync = card('Budget sync');
      await expect(sync).toContainText('Bob accepted Budget sync', {
        timeout: 30_000,
      });
      await expect(sync.getByText('“See you there.”')).toBeVisible();
      saw('STL-516');
    });
  });
}
