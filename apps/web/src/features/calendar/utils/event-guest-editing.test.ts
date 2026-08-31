import type { CalendarAttendee } from '@service-storage/generated/schemas/calendarAttendee';
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../types';
import { guestListChanged, viewerCanEditGuests } from './event-guest-editing';

function attendee(overrides: Partial<CalendarAttendee>): CalendarAttendee {
  return {
    email: 'guest@example.com',
    isOptional: false,
    isOrganizer: false,
    isSelf: false,
    responseStatus: 'needs_action',
    ...overrides,
  };
}

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: '["event","occurrence"]',
    eventId: 'event',
    occurrenceKey: 'occurrence',
    isCancelled: false,
    isReadOnly: false,
    attendees: [],
    recurrenceLines: [],
    title: 'Sync',
    start: '2026-08-27T19:00:00.000Z',
    end: '2026-08-27T20:00:00.000Z',
    allDay: false,
    calendar: { id: 'cal', name: 'Calendar', color: 'orange' },
    ...overrides,
  };
}

describe('viewerCanEditGuests', () => {
  it('allows the organizer to edit guests', () => {
    expect(
      viewerCanEditGuests(
        event({
          attendees: [
            attendee({
              email: 'me@example.com',
              isOrganizer: true,
              isSelf: true,
            }),
            attendee({ email: 'teo@example.com' }),
          ],
        })
      )
    ).toBe(true);
  });

  it('blocks a mere guest from editing the list', () => {
    expect(
      viewerCanEditGuests(
        event({
          attendees: [
            attendee({ email: 'host@example.com', isOrganizer: true }),
            attendee({ email: 'me@example.com', isSelf: true }),
          ],
        })
      )
    ).toBe(false);
  });

  it('allows editing a writable event that has no attendees yet', () => {
    expect(viewerCanEditGuests(event({ attendees: [] }))).toBe(true);
  });

  it('blocks editing a read-only event with no attendees', () => {
    expect(
      viewerCanEditGuests(event({ attendees: [], isReadOnly: true }))
    ).toBe(false);
  });

  it('blocks editing a read-only event even when self organizes it', () => {
    expect(
      viewerCanEditGuests(
        event({
          isReadOnly: true,
          attendees: [
            attendee({
              email: 'me@example.com',
              isOrganizer: true,
              isSelf: true,
            }),
            attendee({ email: 'teo@example.com' }),
          ],
        })
      )
    ).toBe(false);
  });
});

describe('guestListChanged', () => {
  const organized = event({
    attendees: [
      attendee({ email: 'me@example.com', isOrganizer: true, isSelf: true }),
      attendee({ email: 'teo@example.com' }),
    ],
  });

  it('is false when the submitted list matches the seed', () => {
    expect(
      guestListChanged(organized, ['me@example.com', 'teo@example.com'])
    ).toBe(false);
  });

  it('ignores order and case differences', () => {
    expect(
      guestListChanged(organized, ['TEO@example.com', 'me@example.com'])
    ).toBe(false);
  });

  it('is true when a guest is added', () => {
    expect(
      guestListChanged(organized, [
        'me@example.com',
        'teo@example.com',
        'ada@example.com',
      ])
    ).toBe(true);
  });

  it('is true when a guest is removed', () => {
    expect(guestListChanged(organized, ['me@example.com'])).toBe(true);
  });

  it('does not count the viewer-as-guest against the seed', () => {
    // A non-organizer self attendee is excluded from the seed, so resubmitting
    // the visible guest list alone is not a change.
    const invited = event({
      attendees: [
        attendee({ email: 'host@example.com', isOrganizer: true }),
        attendee({ email: 'me@example.com', isSelf: true }),
      ],
    });
    expect(guestListChanged(invited, ['host@example.com'])).toBe(false);
  });
});
