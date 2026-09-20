import type { CalendarInvitation } from './calendar-invitation';

/** Synthetic scheduling corpus shared by UI tests and browser verification. */
export const invitationFixture: CalendarInvitation = {
  id: 'product-review',
  uid: 'product-review@example.com',
  source_part: '1',
  content_hash: 'fixture',
  parser_version: 1,
  method: 'request',
  sequence: 0,
  title: 'Product review',
  organizer: { name: 'Alex Chen', email: 'alex@example.com' },
  start: {
    kind: 'zoned',
    value: '2026-09-24T17:00:00Z',
    local: '2026-09-24T10:00:00',
    time_zone: 'America/Los_Angeles',
  },
  end: {
    kind: 'zoned',
    value: '2026-09-24T17:30:00Z',
    local: '2026-09-24T10:30:00',
    time_zone: 'America/Los_Angeles',
  },
  attendees: [
    { name: 'Alex', email: 'alex@example.com' },
    { name: 'You', email: 'you@example.com' },
    { name: 'Sam', email: 'sam@example.com' },
    { name: 'Riley', email: 'riley@example.com' },
    { name: 'Morgan', email: 'morgan@example.com' },
    { name: 'Taylor', email: 'taylor@example.com' },
  ],
  location: 'Google Meet',
  conference_url: 'https://meet.google.com/abc-defg-hij',
  description:
    'Review the new calendar experience and open questions.\nBring your notes on the updated invitation cards, timezone handling, and the mobile RSVP experience.\nMeeting password: 123456. Dial-in instructions stay available here.',
  recurrence: [],
  files: [],
  timezones: [],
  limitations: [],
};
export const invitationFixtures = {
  new: invitationFixture,
  updated: {
    ...invitationFixture,
    sequence: 2,
    title: 'Product review — new time',
  },
  cancelled: {
    ...invitationFixture,
    method: 'cancel',
    status: 'CANCELLED',
    sequence: 3,
  },
  reply: {
    ...invitationFixture,
    method: 'reply',
    attendees: [
      {
        name: 'Sam',
        email: 'sam@example.com',
        participation_status: 'ACCEPTED',
      },
    ],
    comment: 'See you there.',
  },
  counter: {
    ...invitationFixture,
    method: 'counter',
    comment: 'Can we start half an hour later?',
  },
  allDay: {
    ...invitationFixture,
    title: 'Team offsite',
    start: { kind: 'date', value: '2026-09-24' },
    end: { kind: 'date', value: '2026-09-26' },
  },
  floating: {
    ...invitationFixture,
    start: {
      kind: 'unresolved',
      value: '2026-09-24T10:00:00',
      time_zone: 'Pacific Standard Time',
    },
    end: undefined,
  },
} satisfies Record<string, CalendarInvitation>;
