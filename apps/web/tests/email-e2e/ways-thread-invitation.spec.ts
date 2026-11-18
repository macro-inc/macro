// The invitation card's smaller controls: Retry calendar after the calendar
// could not be asked, a link in the description, the original email and the
// related occurrences behind their disclosures, and Connect calendar. For a
// Gmail and an Outlook inbox.

import { expect, test } from './harness/linking';
import { anInbox, PROVIDERS } from './harness/providers';
import { calendarFile, deliverCalendarFile } from './harness/ways-thread';
import { did } from './ledger/record';

const MAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

for (const provider of PROVIDERS) {
  test.describe(`the invitation card's controls in ${anInbox(provider)}`, () => {
    test.use({ provider });

    // When this fails, Retry calendar does not ask the calendar again after
    // a failure, a link in the event's description opens nothing, the
    // original email or the other occurrences of the series cannot be
    // shown, or Connect calendar does not start a connection that asks for
    // calendar access.
    test('Retry calendar, a description link, the disclosures and Connect calendar', async ({
      page,
      context,
      mailbox,
      auth,
    }) => {
      const review = await deliverCalendarFile(
        mailbox,
        {
          subject: 'Invitation: Planning review',
          text: 'You have been invited to Planning review.',
        },
        {
          filename: 'invite.ics',
          ics: calendarFile({
            uid: 'planning-review-2@example.com',
            summary: 'Planning review',
            description:
              'Read <a href="https://example.com/notes">the notes</a> first.',
          }),
        }
      );
      const standup = await deliverCalendarFile(
        mailbox,
        {
          subject: 'Invitation: Weekly standup',
          text: 'You have been invited to Weekly standup.',
        },
        {
          filename: 'invite.ics',
          ics: calendarFile({
            uid: 'weekly-standup-1@example.com',
            summary: 'Weekly standup',
            moved: true,
          }),
          events: 2,
        }
      );
      // The calendar cannot be asked until the test lets it.
      let calendarDown = true;
      await page.route(/\/calendar-invitations(\?|$)/, (route) =>
        calendarDown
          ? route.fulfill({ status: 503, body: 'unavailable' })
          : route.fallback()
      );
      // Where the description's link leads is not part of the stack.
      await context.route('https://example.com/**', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<p>Notes</p>' })
      );

      await mailbox.open(`/app/mail/${review}`);
      const card = page.getByRole('region', {
        name: 'Calendar invitation: Planning review',
      });
      const unavailable = card.getByText(
        'Calendar unavailable. Showing saved invitation details.'
      );
      await expect(unavailable).toBeVisible({ timeout: 30_000 });
      calendarDown = false;
      await card.getByRole('button', { name: 'Retry calendar' }).click();
      did('AL-184');
      await expect(unavailable).toHaveCount(0);
      await expect(
        card.getByText('Connect a calendar to respond from Macro.')
      ).toBeVisible();

      const opened = context.waitForEvent('page');
      await card.getByRole('link', { name: 'the notes' }).click();
      did('AL-513');
      const notes = await opened;
      await expect(notes).toHaveURL('https://example.com/notes');
      await notes.close();

      // The card stands in for the body, which stays one click away.
      const original = page.getByText(
        'You have been invited to Planning review.'
      );
      await expect(original).toBeHidden();
      await page.getByText('View original email').click();
      did('AL-514');
      await expect(original).toBeVisible();

      // A series with one occurrence moved: the moved one waits under the
      // series' own card.
      await mailbox.open(`/app/mail/${standup}`);
      const cards = page.getByRole('region', {
        name: 'Calendar invitation: Weekly standup',
      });
      await expect(cards.first()).toBeVisible();
      await expect(cards.nth(1)).toBeHidden();
      await page.getByText('View 1 related occurrence').click();
      did('AL-514');
      await expect(cards.nth(1)).toBeVisible();

      await cards
        .first()
        .getByRole('button', { name: 'Connect calendar' })
        .click();
      did('AL-182');
      await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
      const scopes = await page
        .locator('label:has(input[type="checkbox"])')
        .allInnerTexts();
      expect(scopes.map((scope) => scope.trim()).sort()).toEqual([
        CALENDAR_SCOPE,
        MAIL_SCOPE,
      ]);
      expect(auth.starts.map(({ scopes }) => scopes)).toEqual([
        'gmail_and_calendar',
      ]);
    });
  });
}
