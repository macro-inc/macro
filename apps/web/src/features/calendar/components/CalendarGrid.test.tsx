import { Calendar } from '@fullcalendar/core';
import { render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../types';
import { CalendarGrid, type CalendarGridSettings } from './CalendarGrid';

function event(id: string, title: string): CalendarEvent {
  return {
    id,
    eventId: id,
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
    title,
    start: '2026-10-22T14:00:00Z',
    end: '2026-10-22T15:00:00Z',
    allDay: false,
    calendar: { id: 'calendar-1', name: 'Calendar', color: 'orange' },
    visibleCalendars: [],
  };
}

const SETTINGS: CalendarGridSettings = {
  initialView: 'timeGridWeek',
  dayCount: 3,
  showWeekends: true,
  weekStartsOn: 0,
  timeFormat: '12-hour',
  useNarrowDayHeaders: true,
  useNarrowEventContent: false,
};

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the calendar grid', () => {
  it('resets only the events when the events change', async () => {
    const resetOptions = vi.spyOn(Calendar.prototype, 'resetOptions');
    const [events, setEvents] = createSignal([event('a', 'Planning')]);
    render(() => (
      <CalendarGrid
        initialDate={new Date('2026-10-22T12:00:00Z')}
        events={events()}
        eventsById={new Map(events().map((item) => [item.id, item]))}
        settings={{ ...SETTINGS }}
        selection={{
          color: 'blue',
          onEventSelect: () => {},
          onDateSelect: () => {},
        }}
      />
    ));
    await new Promise((done) => setTimeout(done));
    resetOptions.mockClear();

    setEvents([event('a', 'Planning'), event('b', 'Review')]);

    await waitFor(() => expect(resetOptions).toHaveBeenCalled());
    expect(resetOptions.mock.calls.map(([, names]) => names)).toEqual([
      ['events'],
    ]);
  });
});
