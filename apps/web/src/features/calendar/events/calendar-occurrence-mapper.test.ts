import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALENDAR_SOURCE,
  mapCalendarOccurrence,
} from './calendar-occurrence-mapper';

const item = (time: CalendarOccurrenceItem['occurrence']['time']) =>
  ({
    event: {
      id: 'event-1',
      title: 'Planning',
      location: null,
      description: 'Weekly planning',
      conferenceUrl: 'https://meet.example.com/planning',
      conferenceProvider: 'google_meet',
      organizerName: 'Alex Rivera',
      organizerEmail: 'alex@example.com',
      attendees: [
        {
          email: 'alex@example.com',
          displayName: 'Alex Rivera',
          responseStatus: 'accepted',
          isOrganizer: true,
          isOptional: false,
          isSelf: false,
        },
      ],
      recurrenceLines: ['RRULE:FREQ=WEEKLY'],
      isReadOnly: true,
    },
    occurrence: {
      occurrenceKey: '2026-08-04T14:00:00+00:00',
      recurrenceId: 'recurrence-1',
      isCancelled: true,
      time,
    },
  }) as CalendarOccurrenceItem;

describe('mapCalendarOccurrence', () => {
  it('maps a timed occurrence using its occurrence span', () => {
    const event = mapCalendarOccurrence(
      item({
        kind: 'timed',
        startsAt: '2026-08-04T15:00:00Z',
        endsAt: '2026-08-04T16:00:00Z',
        timeZone: 'America/New_York',
      })
    );

    expect(event).toMatchObject({
      eventId: 'event-1',
      occurrenceKey: '2026-08-04T14:00:00+00:00',
      recurrenceId: 'recurrence-1',
      start: '2026-08-04T15:00:00Z',
      end: '2026-08-04T16:00:00Z',
      allDay: false,
      isCancelled: true,
      isReadOnly: true,
      conferenceUrl: 'https://meet.example.com/planning',
      conferenceProvider: 'google_meet',
      organizerName: 'Alex Rivera',
      organizerEmail: 'alex@example.com',
      recurrenceLines: ['RRULE:FREQ=WEEKLY'],
      timeZone: 'America/New_York',
      title: 'Planning',
      description: 'Weekly planning',
      location: undefined,
      calendar: DEFAULT_CALENDAR_SOURCE,
    });
  });

  it('preserves exclusive local dates for an all-day occurrence', () => {
    const event = mapCalendarOccurrence(
      item({
        kind: 'allDay',
        startDate: '2026-08-04',
        endDate: '2026-08-06',
      })
    );

    expect(event).toMatchObject({
      start: '2026-08-04',
      end: '2026-08-06',
      allDay: true,
    });
  });

  it('creates distinct render IDs for occurrences of the same event', () => {
    const first = item({
      kind: 'allDay',
      startDate: '2026-08-04',
      endDate: '2026-08-05',
    });
    const second = {
      ...first,
      occurrence: {
        ...first.occurrence,
        occurrenceKey: '2026-08-11',
      },
    };

    expect(mapCalendarOccurrence(first).id).not.toBe(
      mapCalendarOccurrence(second).id
    );
  });
});
