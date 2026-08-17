/**
 * @vitest-environment jsdom
 */

import type { EventContentArg } from '@fullcalendar/core';
import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import {
  formatCompactCalendarTime,
  formatCompactCalendarTimeRange,
} from '../time-format';
import { CalendarEventContent } from './EventContent';
import type { CalendarEvent } from './types';

const start = new Date(2025, 0, 15, 9);

function calendarEvent(durationMinutes: number): CalendarEvent {
  return {
    id: 'occurrence-1',
    eventId: 'event-1',
    occurrenceKey: 'occurrence-1',
    isReadOnly: false,
    isCancelled: false,
    attendees: [],
    recurrenceLines: [],
    title: 'Planning',
    start: start.toISOString(),
    end: new Date(start.getTime() + durationMinutes * 60 * 1000).toISOString(),
    allDay: false,
    calendar: {
      id: 'calendar-1',
      name: 'Work',
      color: 'red',
    },
  };
}

function renderProps(
  timeText: string,
  options: { allDay?: boolean; viewType?: string } = {}
): EventContentArg {
  return {
    event: { allDay: options.allDay ?? false, start },
    timeText,
    view: { type: options.viewType ?? 'timeGridWeek' },
  } as EventContentArg;
}

describe('CalendarEventContent', () => {
  it('shows only the start time for a 15-minute event', () => {
    render(() => (
      <CalendarEventContent
        event={calendarEvent(15)}
        renderProps={renderProps('9:00 AM - 9:15 AM')}
        isSelected={false}
        timeFormat="12-hour"
      />
    ));

    expect(
      screen.getByText(formatCompactCalendarTime(start, '12-hour'))
    ).toBeTruthy();
    expect(screen.queryByText('9:00 AM - 9:15 AM')).toBeNull();
  });

  it('preserves the time range for longer events', () => {
    render(() => (
      <CalendarEventContent
        event={calendarEvent(30)}
        renderProps={renderProps('9:00 AM - 9:30 AM')}
        isSelected={false}
        timeFormat="12-hour"
      />
    ));

    expect(
      screen.getByText(
        formatCompactCalendarTimeRange(
          start,
          new Date(start.getTime() + 30 * 60 * 1000),
          '12-hour'
        )
      )
    ).toBeTruthy();
  });

  it('uses compact content when a timed event is rendered in the all-day row', () => {
    const event = {
      ...calendarEvent(24 * 60),
      location: 'Conference room',
    };
    const { container } = render(() => (
      <CalendarEventContent
        event={event}
        renderProps={renderProps('', {
          allDay: true,
          viewType: 'timeGridDay',
        })}
        isSelected={false}
        timeFormat="12-hour"
      />
    ));

    expect(
      container.querySelector('.calendar-event-content-compact')
    ).toBeTruthy();
    expect(
      container.querySelector('.calendar-event-content-layout-single-line')
    ).toBeTruthy();
    expect(
      screen.getByText(formatCompactCalendarTime(start, '12-hour'))
    ).toBeTruthy();
    expect(screen.queryByText('Conference room')).toBeNull();
  });
});
