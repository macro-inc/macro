import type { CalendarEvent } from '../types';

export const RECURRING_EVENT: CalendarEvent = {
  id: 'rendered-occurrence',
  eventId: 'series',
  calendarId: 'calendar',
  occurrenceKey: '2026-11-09T15:00:00Z',
  recurrenceLines: ['RRULE:FREQ=WEEKLY'],
  start: '2026-11-09T15:00:00Z',
  end: '2026-11-09T16:00:00Z',
  timeZone: 'America/New_York',
  allDay: false,
  seriesTime: {
    kind: 'timed',
    startsAt: '2026-10-26T14:00:00Z',
    endsAt: '2026-10-26T15:00:00Z',
    timeZone: 'America/New_York',
  },
  isCancelled: false,
  isReadOnly: false,
  title: 'Weekly event',
  attendees: [],
  guestPolicy: {
    canModify: true,
    canInviteOthers: true,
    canSeeOtherGuests: true,
  },
  viewerCan: {
    editDetails: true,
    inviteGuests: true,
    removeGuests: true,
    setGuestPolicy: true,
    organize: true,
    rsvp: false,
  },
  sourceCalendarIds: ['calendar'],
  visibleCalendars: [],
  calendar: { id: 'calendar', name: 'Calendar', color: 'blue' },
};
