// @vitest-environment jsdom
import type { Calendar } from '@fullcalendar/core';
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../types';
import { CalendarGrid } from './CalendarGrid';

const events: CalendarEvent[] = Array.from({ length: 4 }, (_, index) => ({
  id: `event-${index}`,
  eventId: `event-${index}`,
  occurrenceKey: '2026-11-20',
  title: `Planning event ${index}`,
  start: `2026-11-20T${10 + index}:00:00`,
  end: `2026-11-20T${11 + index}:00:00`,
  allDay: false,
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
    rsvp: false,
    organize: false,
  },
  attendees: [],
  recurrenceLines: [],
  sourceCalendarIds: ['calendar'],
  calendarId: 'calendar',
  calendar: { id: 'calendar', name: 'Calendar', color: 'orange' },
  visibleCalendars: [],
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shares Month event content and presentation in the grid and overflow', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const offsetParent = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetParent'
  )?.get;
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('fc-popover')
        ? this.parentElement
        : (offsetParent?.call(this) ?? null);
    }
  );
  let calendar: Calendar | undefined;
  const { container } = render(() => (
    <CalendarGrid
      initialDate={new Date(2026, 10, 20)}
      events={events}
      eventsById={new Map(events.map((event) => [event.id, event]))}
      settings={{
        initialView: 'dayGridMonth',
        showWeekends: true,
        weekStartsOn: 0,
        timeFormat: '24-hour',
        useNarrowDayHeaders: false,
        useNarrowEventContent: false,
      }}
      selection={{ color: 'orange' }}
    >
      {(handle) => {
        calendar = handle.api();
        return null;
      }}
    </CalendarGrid>
  ));
  calendar?.setOption('views', { dayGridMonth: { dayMaxEvents: 1 } });
  const more = container.querySelector<HTMLElement>('.fc-more-link');
  expect(more).not.toBeNull();
  fireEvent.click(more!);
  await waitFor(() =>
    expect(
      container.querySelector('.fc-more-popover .calendar-event-content')
    ).not.toBeNull()
  );
  const grid = container.querySelector<HTMLElement>(
    '.fc-dayGridMonth-view .calendar-event-content'
  );
  const overflow = container.querySelector<HTMLElement>(
    '.fc-more-popover .calendar-event-content'
  );
  for (const content of [grid, overflow]) {
    expect(
      content?.closest('.fc-event')?.classList.contains('calendar-month-event')
    ).toBe(true);
    const title = content?.querySelector('.calendar-event-title-row');
    const time = content?.querySelector('.calendar-event-time');
    expect(title).not.toBeNull();
    expect(time).not.toBeNull();
    expect(title?.nextElementSibling).toBe(time);
    expect(title?.classList.contains('min-w-0')).toBe(true);
    expect(title?.classList.contains('flex-1')).toBe(false);
    expect(time?.classList.contains('shrink-0')).toBe(true);
    expect(time?.classList.contains('ml-auto')).toBe(false);
  }
});
