import { describe, expect, it } from 'vitest';
import { type CalendarAgendaEvent, groupAgendaEvents } from './calendar-agenda';
import {
  type FilterableCalendarEvent,
  matchesCalendarEventFilter,
} from './calendar-home';

const attendee = {
  email: 'me@example.com',
  isSelf: true,
  isOrganizer: false,
  responseStatus: 'accepted',
};
const event: FilterableCalendarEvent = {
  attendees: [attendee],
};

describe('calendar event filters', () => {
  it('includes every event in All Events', () => {
    expect(matchesCalendarEventFilter(event, 'all')).toBe(true);
  });

  it('includes events created or organized by the viewer in My Events', () => {
    expect(
      matchesCalendarEventFilter(
        { ...event, attendees: [], creatorEmail: 'ME@example.com' },
        'my',
        'me@example.com'
      )
    ).toBe(true);
    expect(
      matchesCalendarEventFilter(
        { ...event, attendees: [{ ...attendee, isOrganizer: true }] },
        'my'
      )
    ).toBe(true);
  });

  it('includes accepted and tentative RSVPs in My Events', () => {
    expect(matchesCalendarEventFilter(event, 'my')).toBe(true);
    expect(
      matchesCalendarEventFilter(
        {
          ...event,
          attendees: [{ ...attendee, responseStatus: 'tentative' }],
        },
        'my'
      )
    ).toBe(true);
  });

  it('excludes unanswered and declined invitations from My Events', () => {
    expect(
      matchesCalendarEventFilter(
        {
          ...event,
          attendees: [{ ...attendee, responseStatus: 'needs_action' }],
        },
        'my'
      )
    ).toBe(false);
    expect(
      matchesCalendarEventFilter(
        {
          ...event,
          attendees: [{ ...attendee, responseStatus: 'declined' }],
        },
        'my'
      )
    ).toBe(false);
  });
});

describe('calendar agenda', () => {
  it('orders events chronologically and keeps all-day dates on their local day', () => {
    const makeEvent = (id: string, start: string): CalendarAgendaEvent => ({
      id,
      start,
      end: start,
      title: id,
      allDay: start.length === 10,
      color: '',
      calendar: '',
      hasCall: false,
    });
    const groups = groupAgendaEvents([
      makeEvent('later', '2026-09-19'),
      makeEvent('afternoon', '2026-09-18T14:00:00'),
      makeEvent('all-day', '2026-09-18'),
      makeEvent('morning', '2026-09-18T09:00:00'),
    ]);
    expect(groups.map((group) => group.day)).toEqual([
      '2026-09-18',
      '2026-09-19',
    ]);
    expect(groups[0].events.map((value) => value.id)).toEqual([
      'all-day',
      'morning',
      'afternoon',
    ]);
  });
});
