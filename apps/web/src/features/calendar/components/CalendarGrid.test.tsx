/** @vitest-environment jsdom */
import { Calendar } from '@fullcalendar/core';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  type CalendarEvent,
  DEFAULT_CALENDAR_SOURCE,
  DEFAULT_GUEST_POLICY,
  NO_VIEWER_CAPABILITIES,
} from '../types';
import {
  CalendarGrid,
  type CalendarGridHandle,
  type CalendarGridSelection,
  type CalendarGridSettings,
} from './CalendarGrid';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1)
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps unchanged presentation options and dispatches clicks to the current selection handler', () => {
  const event: CalendarEvent = {
    id: 'planning',
    eventId: 'planning',
    occurrenceKey: '2025-01-15',
    title: 'Synthetic planning',
    start: '2025-01-15',
    end: '2025-01-16',
    allDay: true,
    isCancelled: false,
    isReadOnly: true,
    attendees: [],
    guestPolicy: DEFAULT_GUEST_POLICY,
    viewerCan: NO_VIEWER_CAPABILITIES,
    sourceCalendarIds: [],
    recurrenceLines: [],
    calendar: DEFAULT_CALENDAR_SOURCE,
    visibleCalendars: [DEFAULT_CALENDAR_SOURCE],
  };
  const first = vi.fn();
  const latest = vi.fn();
  const [settings, setSettings] = createSignal<CalendarGridSettings>({
    initialView: 'dayGridMonth',
    showWeekends: true,
    weekStartsOn: 1,
    timeFormat: '12-hour',
    useNarrowDayHeaders: false,
    useNarrowEventContent: false,
  });
  const [selection, setSelection] = createSignal<CalendarGridSelection>({
    color: 'red',
    onEventSelect: first,
  });
  let grid: CalendarGridHandle | undefined;
  render(() => (
    <CalendarGrid
      initialDate={new Date('2025-01-15T12:00:00')}
      events={[event]}
      eventsById={new Map([[event.id, event]])}
      settings={settings()}
      selection={selection()}
    >
      {(handle) => {
        grid = handle;
        return null;
      }}
    </CalendarGrid>
  ));
  const reset = vi.spyOn(Calendar.prototype, 'resetOptions');
  setSettings({ ...settings() });
  setSelection({ color: 'blue', onEventSelect: latest });
  expect(reset).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Synthetic planning'));
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledWith(event, expect.any(HTMLElement));

  setSettings({ ...settings(), useNarrowDayHeaders: true });
  expect(reset).toHaveBeenCalledOnce();
  expect(grid?.api()?.getOption('dayHeaderFormat')).toEqual({
    weekday: 'narrow',
  });
  setSelection({ color: 'blue' });
  expect(grid?.api()?.getOption('eventClick')).toBeUndefined();
  fireEvent.click(screen.getByText('Synthetic planning'));
  expect(latest).toHaveBeenCalledOnce();
});
