import type { CalendarAttendee } from '@service-storage/generated/schemas/calendarAttendee';
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../types';
import { eventEmailRecipients, guestEmails } from './guest-emails';

function attendee(
  email: string,
  overrides: Partial<CalendarAttendee> = {}
): CalendarAttendee {
  return {
    email,
    isOptional: false,
    isOrganizer: false,
    isSelf: false,
    responseStatus: 'accepted',
    ...overrides,
  };
}

function event(attendees: CalendarAttendee[]): CalendarEvent {
  return {
    id: '["event","occurrence"]',
    eventId: 'event',
    occurrenceKey: 'occurrence',
    isCancelled: false,
    isReadOnly: false,
    attendees,
    recurrenceLines: [],
    sourceCalendarIds: [],
    title: 'Demo call',
    start: '2026-09-14T19:00:00.000Z',
    end: '2026-09-14T19:30:00.000Z',
    allDay: false,
    calendar: {
      id: 'jacob-cal',
      name: 'Jacob Beckerman',
      color: 'orange',
      emailAddress: 'jacob@example.com',
      isPrimary: true,
    },
    visibleCalendars: [],
  };
}

describe('guestEmails', () => {
  it('lists every guest, the viewer included, in guest-list order', () => {
    expect(
      guestEmails([
        attendee('daniel@example.com'),
        attendee('jacob@example.com', { isSelf: true }),
        attendee('teo@example.com', { isOptional: true }),
      ])
    ).toEqual(['daniel@example.com', 'jacob@example.com', 'teo@example.com']);
  });

  it('lists an address once however it is cased or padded', () => {
    expect(
      guestEmails([
        attendee('Daniel@Example.com'),
        attendee(' daniel@example.com '),
        attendee(''),
      ])
    ).toEqual(['Daniel@Example.com']);
  });
});

describe('eventEmailRecipients', () => {
  it('addresses every guest but the viewer', () => {
    expect(
      eventEmailRecipients(
        event([
          attendee('daniel@example.com'),
          attendee('jacob@example.com', { isSelf: true }),
          attendee('organizer@example.com', { isOrganizer: true }),
        ])
      )
    ).toEqual(['daniel@example.com', 'organizer@example.com']);
  });

  it('is empty when the viewer is the only guest', () => {
    expect(
      eventEmailRecipients(
        event([attendee('jacob@example.com', { isSelf: true })])
      )
    ).toEqual([]);
  });

  it('is empty for an event without guests', () => {
    expect(eventEmailRecipients(event([]))).toEqual([]);
  });
});
