/**
 * @vitest-environment jsdom
 */

import type { CalendarEvent } from '@app/features/calendar/types';
import type { EventContentArg } from '@fullcalendar/core';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { attachCalendarMacroCall } from '../utils/macro-call-link';
import { EventContent } from './EventContent';

const CALL_URL =
  'https://macro.com/app/meet/join/8m8mGwzHqxzYjeIN5-nJRquRbzyTEhGF';

afterEach(cleanup);

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: '["event-1","2026-10-22T14:00:00Z"]',
    eventId: 'event-1',
    occurrenceKey: '2026-10-22T14:00:00Z',
    isCancelled: false,
    isReadOnly: false,
    guestPolicy: {
      canModify: false,
      canInviteOthers: true,
      canSeeOtherGuests: true,
    },
    viewerCan: {
      editDetails: false,
      inviteGuests: false,
      removeGuests: false,
      setGuestPolicy: false,
      rsvp: true,
      organize: false,
    },
    attendees: [],
    recurrenceLines: [],
    sourceCalendarIds: ['calendar-1'],
    calendarId: 'calendar-1',
    title: 'Planning',
    start: '2026-10-22T14:00:00Z',
    end: '2026-10-22T15:00:00Z',
    allDay: false,
    calendar: { id: 'calendar-1', name: 'Calendar', color: 'orange' },
    visibleCalendars: [],
    ...overrides,
  };
}

/** A Macro call as the editor saves it, next to whatever location was typed. */
function macroCallEvent(typedLocation: string) {
  return event(
    attachCalendarMacroCall(
      { description: '<p>Agenda</p>', location: typedLocation },
      CALL_URL
    )
  );
}

function renderDayChip(calendarEvent: CalendarEvent) {
  const renderProps = {
    event: { allDay: false },
    view: { type: 'timeGridDay' },
    timeText: '',
  } as unknown as EventContentArg;
  return render(() => (
    <EventContent
      event={calendarEvent}
      renderProps={renderProps}
      isSelected={false}
      timeFormat="12-hour"
    />
  ));
}

describe('the location on a day view event chip', () => {
  it('leaves out a Macro call link saved as the only location', () => {
    const { container } = renderDayChip(macroCallEvent(''));

    expect(screen.getByText('Planning')).toBeTruthy();
    expect(container.textContent).not.toContain('/meet/');
  });

  it('shows the location typed next to a Macro call', () => {
    const { container } = renderDayChip(macroCallEvent('Room 4B'));

    expect(screen.getByText('Room 4B')).toBeTruthy();
    expect(container.textContent).not.toContain('/meet/');
  });

  it('shows a provider meeting link or a place as written', () => {
    for (const location of [
      'https://meet.google.com/abc-defg-hij',
      'https://zoom.us/j/123456789',
      'Conference room 4B, third floor',
    ]) {
      renderDayChip(event({ location }));

      expect(screen.getByText(location)).toBeTruthy();
      cleanup();
    }
  });
});
