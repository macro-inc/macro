import { expect, test } from './harness/fixtures';

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

test.describe('an invitation in the thread', () => {
  // Class cal-invitation-mail: when this fails, an invitation whose
  // description is HTML shows its tags as text in the card (`<b>agenda</b>`)
  // instead of the formatted description, or the invitation is not shown as
  // a card at all.
  test('an HTML description shows formatted in the invitation card, without its tags', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Invitation: Planning review',
      text: 'You have been invited to Planning review.',
      attachments: [
        {
          filename: 'invite.ics',
          mimeType: 'text/calendar; method=REQUEST; charset=UTF-8',
          base64: Buffer.from(
            invitation(
              'Bring the <b>agenda</b> and read <a href="https://example.com/notes">the notes</a> first.'
            )
          ).toString('base64'),
        },
      ],
    });
    const thread = await mailbox.synced('Invitation: Planning review');

    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');

    const card = page.getByRole('region', {
      name: 'Calendar invitation: Planning review',
    });
    await expect(card).toBeVisible();
    saw('STL-514');
    await expect(card.locator('b', { hasText: 'agenda' })).toBeVisible();
    await expect(card.getByRole('link', { name: 'the notes' })).toHaveAttribute(
      'href',
      'https://example.com/notes'
    );
    await expect(card).not.toContainText('<b>');
    await expect(card).not.toContainText('<a href');
  });
});
