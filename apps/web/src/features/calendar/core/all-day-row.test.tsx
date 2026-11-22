/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarGrid } from '../components/CalendarGrid';
import type { CalendarEvent } from '../types';
import { ALL_DAY_ROW_LANE_HEIGHT, ALL_DAY_ROW_MAX_HEIGHT } from './all-day-row';

function allDayEvent(index: number): CalendarEvent {
  return {
    id: `event-${index}`,
    eventId: `event-${index}`,
    occurrenceKey: '2026-10-22',
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
    sourceCalendarIds: ['calendar-1'],
    calendarId: 'calendar-1',
    title: `All-day event ${index}`,
    start: '2026-10-22',
    end: '2026-10-23',
    allDay: true,
    calendar: { id: 'calendar-1', name: 'Calendar', color: 'orange' },
    visibleCalendars: [],
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('compact all-day row in the real CalendarGrid', () => {
  it('allocates native lanes and exposes overflowing events until the list shrinks', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    // jsdom has no layout, so FullCalendar's popover needs a containing element.
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
    let setEvents!: (events: CalendarEvent[]) => void;
    const { container } = render(() => {
      const [events, updateEvents] = createSignal<CalendarEvent[]>([]);
      setEvents = updateEvents;
      return (
        <CalendarGrid
          initialDate={new Date(2026, 9, 22)}
          events={events()}
          eventsById={new Map(events().map((event) => [event.id, event]))}
          settings={{
            initialView: 'timeGridDay',
            compactAllDaySlot: true,
            showWeekends: true,
            weekStartsOn: 0,
            timeFormat: '12-hour',
            useNarrowDayHeaders: true,
            useNarrowEventContent: true,
          }}
          selection={{ color: 'orange' }}
        />
      );
    });
    const host = container.querySelector<HTMLElement>('.calendar-view-host');
    const row = container.querySelector<HTMLElement>(
      '.fc-timegrid .fc-daygrid-day-events'
    );
    expect(host).not.toBeNull();
    expect(row).not.toBeNull();
    expect(host?.style.getPropertyValue('--calendar-all-day-lane-height')).toBe(
      `${ALL_DAY_ROW_LANE_HEIGHT}px`
    );
    expect(host?.style.getPropertyValue('--calendar-all-day-max-height')).toBe(
      `${ALL_DAY_ROW_MAX_HEIGHT}px`
    );

    const chips = () => row?.querySelectorAll('.fc-daygrid-event') ?? [];
    const moreLink = () =>
      row?.querySelector<HTMLAnchorElement>('.fc-more-link');
    expect(chips()).toHaveLength(0);
    expect(moreLink()).toBeNull();

    setEvents([allDayEvent(1)]);
    expect(chips()).toHaveLength(1);
    expect(moreLink()).toBeNull();

    setEvents([allDayEvent(1), allDayEvent(2)]);
    expect(chips()).toHaveLength(2);
    expect(moreLink()).toBeNull();

    setEvents([allDayEvent(1), allDayEvent(2), allDayEvent(3), allDayEvent(4)]);
    expect(moreLink()).not.toBeNull();
    fireEvent.click(moreLink()!);
    await waitFor(() => {
      const popover = container.querySelector('.fc-more-popover');
      expect(popover?.textContent).toContain('All-day event 4');
    });

    setEvents([allDayEvent(1)]);
    expect(chips()).toHaveLength(1);
    expect(moreLink()).toBeNull();

    setEvents([]);
    expect(chips()).toHaveLength(0);
    expect(moreLink()).toBeNull();
  });
});
