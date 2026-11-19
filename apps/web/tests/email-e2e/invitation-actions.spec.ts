// What an invitation card offers when no calendar is connected: the saved
// details and Connect calendar, and none of the actions that need the event
// in a calendar (Join, Open in calendar, Add to calendar). The stack runs no
// calendar service, so those actions themselves are not driven here.

import type { Mailbox } from './harness/fixtures';
import { expect, test } from './harness/fixtures';
import { PROVIDERS } from './harness/providers';
import { threadMessages } from './harness/send';
import { did, saw } from './ledger/record';

/** An invitation to a meeting with a video link, as an `.ics` file. */
const INVITATION = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Example//Calendar//EN',
  'VERSION:2.0',
  'CALSCALE:GREGORIAN',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'DTSTART:20270114T170000Z',
  'DTEND:20270114T180000Z',
  'DTSTAMP:20261112T120000Z',
  'ORGANIZER;CN=Grace:mailto:grace@example.com',
  'UID:planning-review-2@example.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Ada:mailto:ada@example.com',
  'X-GOOGLE-CONFERENCE:https://meet.example/planning-review',
  'DESCRIPTION:Bring the agenda.',
  'SEQUENCE:0',
  'STATUS:CONFIRMED',
  'SUMMARY:Planning review',
  'TRANSP:OPAQUE',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

/**
 * Delivers the invitation the way each provider carries one: Gmail as an
 * `.ics` attachment, Outlook as an event message holding the calendar.
 */
async function deliverInvitation(mailbox: Mailbox) {
  const mail = {
    from: 'Grace <grace@example.com>',
    subject: 'Invitation: Planning review',
    text: 'You have been invited to Planning review.',
  };
  if (mailbox.inbox.provider === 'GMAIL') {
    await mailbox.deliver({
      ...mail,
      attachments: [
        {
          filename: 'invite.ics',
          mimeType: 'text/calendar; method=REQUEST; charset=UTF-8',
          base64: Buffer.from(INVITATION).toString('base64'),
        },
      ],
    });
    return;
  }
  const response = await fetch(
    `${mailbox.stack.info.outlookUrl}/_emulator/mailboxes/${encodeURIComponent(mailbox.inbox.email)}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...mail, calendar: INVITATION }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Outlook refused the invitation: ${response.status} ${await response.text()}`
    );
  }
}

for (const provider of PROVIDERS) {
  const inbox = provider === 'GMAIL' ? 'a Gmail' : 'an Outlook';

  test.describe(`the actions of an invitation in ${inbox} inbox`, () => {
    test.use({ provider });

    test('without a calendar the card shows the saved details and offers to connect one, and no action on the event', async ({
      page,
      mailbox,
    }) => {
      await deliverInvitation(mailbox);
      const thread = await mailbox.synced('Invitation: Planning review');
      // The invitation is read out of the message after the message syncs.
      await expect
        .poll(
          async () =>
            (await threadMessages(mailbox, thread.id)).map(
              (message) =>
                ((message.calendar_invitations as unknown[]) ?? []).length
            ),
          { timeout: 60_000 }
        )
        .toEqual([1]);

      await mailbox.open(`/app/mail/${thread.id}`);
      did('AL-910');
      const card = page.getByRole('region', {
        name: 'Calendar invitation: Planning review',
      });
      await expect(card).toBeVisible();
      saw('STL-514');
      // No calendar is connected: the card says so and offers to connect one.
      await expect(
        card.getByText('Connect a calendar to respond from Macro.')
      ).toBeVisible();
      saw('STL-096');
      await expect(
        card.getByRole('button', { name: 'Connect calendar' })
      ).toBeVisible();

      // Nothing that needs the event in a calendar is offered.
      for (const name of [
        'Join meeting',
        'Open in calendar',
        'Add to calendar',
      ]) {
        await expect(card.getByRole('button', { name })).toHaveCount(0);
      }
    });
  });
}
