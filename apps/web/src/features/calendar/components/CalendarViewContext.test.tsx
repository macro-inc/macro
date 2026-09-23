/** @vitest-environment jsdom */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../types';
import {
  CalendarViewContextProvider,
  useCalendarView,
} from './CalendarViewContext';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('../hooks/use-calendar-sources', () => ({
  useCalendarSources: () => ({
    sources: () => [],
    sourceById: () => new Map(),
  }),
}));

const event: CalendarEvent = {
  id: 'event-1',
  eventId: 'event-1',
  occurrenceKey: '2026-10-01T14:00:00Z',
  isCancelled: false,
  isReadOnly: false,
  attendees: [],
  recurrenceLines: [],
  title: 'Next week',
  start: '2026-10-01T14:00:00Z',
  end: '2026-10-01T15:00:00Z',
  allDay: false,
  sourceCalendarIds: ['calendar-1'],
  calendarId: 'calendar-1',
  calendar: { id: 'calendar-1', name: 'Work', color: 'blue' },
  visibleCalendars: [],
};

function setup() {
  let calendar!: ReturnType<typeof useCalendarView>;
  const Harness = () => {
    calendar = useCalendarView();
    return null;
  };
  render(() => (
    <CalendarViewContextProvider>
      <Harness />
    </CalendarViewContextProvider>
  ));
  return calendar;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it('keeps agenda event details open outside the current calendar week', () => {
  const calendar = setup();
  const anchor = document.createElement('button');
  calendar.selectEvent(event, anchor, 'agenda');

  calendar.refreshSelectedEventFromPage(new Map(), true);

  expect(calendar.selectedEvent()).toBe(event);
  expect(calendar.selectedEventAnchor()).toBe(anchor);
});

it('closes a missing grid event only after the current range finishes loading', () => {
  const calendar = setup();
  calendar.selectEvent(event, document.createElement('button'));

  calendar.refreshSelectedEventFromPage(new Map(), false);
  expect(calendar.selectedEvent()).toBe(event);

  calendar.refreshSelectedEventFromPage(new Map(), true);
  expect(calendar.selectedEvent()).toBeUndefined();
  expect(calendar.selectedEventAnchor()).toBeUndefined();
});

it('refreshes an agenda event when it appears in the grid and closes it when hidden', () => {
  const calendar = setup();
  calendar.selectEvent(event, document.createElement('button'), 'agenda');
  const updated = { ...event, title: 'Updated event' };

  calendar.refreshSelectedEventFromPage(new Map([[event.id, updated]]), true);
  expect(calendar.selectedEvent()).toBe(updated);

  calendar.setSourceVisibility('calendar-1', false);
  expect(calendar.selectedEvent()).toBeUndefined();
});
