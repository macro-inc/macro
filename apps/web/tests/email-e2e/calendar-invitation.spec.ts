import type { Mailbox } from './harness/fixtures';
import { expect, test } from './harness/fixtures';
import { PROVIDERS } from './harness/providers';
import { threadMessages } from './harness/send';

import { did, saw } from './ledger/record';

/** A Google-style invitation whose description is HTML, as an `.ics` file. */
function invitation(description: string): string {
  return [
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
    'UID:planning-review-1@example.com',
    'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Ada:mailto:ada@example.com',
    'ATTENDEE;CN=Linus:mailto:linus@example.com',
    'ATTENDEE;CN=Edsger:mailto:edsger@example.com',
    'ATTENDEE;CN=Barbara:mailto:barbara@example.com',
    'ATTENDEE;CN=Donald:mailto:donald@example.com',
    `DESCRIPTION:${description}`,
    'SEQUENCE:0',
    'STATUS:CONFIRMED',
    'SUMMARY:Planning review',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/**
 * Delivers an invitation the way each provider carries one: Gmail as an
 * `.ics` attachment, Outlook as an event message holding the calendar.
 */
async function deliverInvitation(mailbox: Mailbox, ics: string) {
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
          base64: Buffer.from(ics).toString('base64'),
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
      body: JSON.stringify({ ...mail, calendar: ics }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Outlook refused the invitation: ${response.status} ${await response.text()}`
    );
  }
}

for (const provider of PROVIDERS) {
  test.describe(`an invitation in the thread (${provider})`, () => {
    test.use({ provider });

    // Class cal-invitation-mail: when this fails, an invitation whose
    // description is HTML shows its tags as text in the card (`<b>agenda</b>`)
    // instead of the formatted description, the long guest list cannot be
    // opened, or the invitation is not shown as a card at all.
    test('an HTML description shows formatted in the invitation card, without its tags, and the guest list opens', async ({
      page,
      mailbox,
    }) => {
      await deliverInvitation(
        mailbox,
        invitation(
          'Bring the <b>agenda</b> and read <a href="https://example.com/notes">the notes</a> first.'
        )
      );
      const thread = await mailbox.synced('Invitation: Planning review');
      // The invitation is read out of the message after the message itself
      // syncs, and an open thread hears of it over the websocket the stack
      // does not run: open the thread once the service holds the invitation.
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
      await expect(card.locator('b', { hasText: 'agenda' })).toBeVisible();
      await expect(
        card.getByRole('link', { name: 'the notes' })
      ).toHaveAttribute('href', 'https://example.com/notes');
      await expect(card).not.toContainText('<b>');
      await expect(card).not.toContainText('<a href');

      // Five guests: three are named, the rest wait behind "+2 more".
      await expect(card.getByText('Ada, Linus, Edsger')).toBeVisible();
      await expect(card).not.toContainText('Barbara');
      await card.getByRole('button', { name: '+2 more' }).click();
      did('AL-185');
      await expect(
        card.getByText('Ada, Linus, Edsger, Barbara, Donald')
      ).toBeVisible();
      await expect(
        card.getByRole('button', { name: 'Show fewer' })
      ).toBeVisible();
      saw('STL-098');
    });
  });
}
