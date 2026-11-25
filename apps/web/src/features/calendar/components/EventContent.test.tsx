/**
 * @vitest-environment jsdom
 */

import type { CalendarEvent } from '@app/features/calendar/types';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clipLightDayBars,
  lightCalendarEvents,
  lightDayBars,
  lightGridDays,
  lightMonthRows,
  lightTimeBlocks,
} from '../core/light-grid';
import { calendarPageDateInfo } from '../core/page-range';
import { attachCalendarMacroCall } from '../utils/macro-call-link';
import { EventContent } from './EventContent';
import { LightCalendarGrid } from './LightCalendarGrid';

const CALL_URL =
  'https://macro.com/app/meet/join/8m8mGwzHqxzYjeIN5-nJRquRbzyTEhGF';

beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
  };
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

describe('lightweight calendar event geometry', () => {
  it('matches overlapping column expansion without changing the event model', () => {
    const source = event({
      start: '2026-11-02T09:00:00',
      end: '2026-11-02T10:00:00',
    });
    const later = event({
      id: 'second',
      start: '2026-11-02T09:30:00',
      end: '2026-11-02T10:30:00',
    });
    const blocks = lightTimeBlocks(
      lightCalendarEvents([source, later]),
      new Date(2026, 10, 2),
      64
    );
    expect(
      blocks.map(({ top, bottom, near, far }) => ({ top, bottom, near, far }))
    ).toEqual([
      { top: 576, bottom: 640, near: 0, far: 1 },
      { top: 608, bottom: 672, near: 0.5, far: 1 },
    ]);
    expect(blocks[0].event).toBe(source);
  });

  it('keeps point events visible and uses exclusive midnight for multi-day events', () => {
    const point = event({
      start: '2026-11-02T09:00:00',
      end: '2026-11-02T09:00:00',
    });
    const midnight = event({
      id: 'midnight',
      start: '2026-11-02T23:00:00',
      end: '2026-11-03T00:00:00',
    });
    const multi = event({
      id: 'multi',
      start: '2026-11-02T23:00:00',
      end: '2026-11-03T01:00:00',
    });
    const mapped = lightCalendarEvents([point, midnight, multi]);
    expect(mapped.find(({ event }) => event.id === 'multi')?.allDay).toBe(true);
    expect(mapped.find(({ event }) => event.id === 'midnight')?.allDay).toBe(
      false
    );
    const blocks = lightTimeBlocks(mapped, new Date(2026, 10, 2), 64);
    const instant = blocks.find(({ event }) => event === point);
    expect(instant && instant.bottom - instant.top).toBe(15);
    expect(blocks.find(({ event }) => event === midnight)?.bottom).toBe(1536);
  });

  it('packs all-day spans across hidden weekends and retains overflow lanes', () => {
    const days = lightGridDays(
      new Date(2026, 10, 2),
      new Date(2026, 10, 9),
      false
    );
    expect(days.map((date) => date.getDay())).toEqual([1, 2, 3, 4, 5]);
    const events = [0, 1, 2].map((index) =>
      event({
        id: String(index),
        allDay: true,
        start: '2026-11-02',
        end: '2026-11-09',
      })
    );
    const bars = lightDayBars(lightCalendarEvents(events), days);
    expect(bars.map(({ start, end, lane }) => ({ start, end, lane }))).toEqual([
      { start: 0, end: 5, lane: 0 },
      { start: 0, end: 5, lane: 1 },
      { start: 0, end: 5, lane: 2 },
    ]);
    const clipped = clipLightDayBars(bars, days.length, 2);
    expect(
      clipped.bars.map(({ start, end, lane }) => ({ start, end, lane }))
    ).toEqual([{ start: 0, end: 5, lane: 0 }]);
    expect(clipped.hidden).toEqual([2, 2, 2, 2, 2]);
  });
  it('fits short Month rows and reserves space for overflow without clipping', () => {
    const days = lightGridDays(
      new Date(2026, 10, 2),
      new Date(2026, 10, 3),
      true
    );
    const bars = lightDayBars(
      lightCalendarEvents(
        [0, 1, 2].map((index) =>
          event({
            id: String(index),
            allDay: true,
            start: '2026-11-02',
            end: '2026-11-03',
          })
        )
      ),
      days,
      true
    );
    const full = lightMonthRows(bars, 1, 64);
    expect(full.bars).toHaveLength(3);
    expect(full.offsets).toEqual([0, 21, 42]);
    const capped = lightMonthRows(bars, 1, 45);
    expect(capped.bars).toHaveLength(1);
    expect(capped.hidden).toEqual([2]);
    expect(capped.overflowTop).toBe(21);
  });
});

describe('query-free calendar projection updates', () => {
  it('reuses date cells and event nodes while a slot changes dates', () => {
    const [state, setState] = createSignal({
      date: new Date(2026, 10, 2),
      event: event({
        start: '2026-11-02T09:00:00',
        end: '2026-11-02T10:00:00',
      }),
    });
    const { container } = render(() => (
      <LightCalendarGrid
        date={state().date}
        now={new Date(2026, 10, 1)}
        dateInfo={calendarPageDateInfo(state().date, 'timeGridDay', {
          weekStartsOn: 0,
          showWeekends: true,
          phone: false,
        })}
        events={[state().event]}
        settings={{
          initialView: 'timeGridDay',
          showWeekends: true,
          weekStartsOn: 0,
          timeFormat: '24-hour',
          useNarrowDayHeaders: false,
          useNarrowEventContent: false,
        }}
      />
    ));
    const cell = container.querySelector('.fc-timegrid-col');
    const title = container.querySelector('.calendar-event-title');
    setState({
      date: new Date(2026, 10, 3),
      event: event({
        start: '2026-11-03T09:00:00',
        end: '2026-11-03T10:00:00',
      }),
    });
    expect(container.querySelector('.fc-timegrid-col')).toBe(cell);
    expect(container.querySelector('.calendar-event-title')).toBe(title);
    expect(cell?.getAttribute('data-date')).toBe('2026-11-03');
  });

  it('advances the today marker and current-time line from the shared clock', () => {
    const [now, setNow] = createSignal(new Date(2026, 10, 2, 23, 59));
    const date = new Date(2026, 10, 1);
    const { container } = render(() => (
      <LightCalendarGrid
        date={date}
        now={now()}
        dateInfo={calendarPageDateInfo(date, 'timeGridWeek', {
          weekStartsOn: 0,
          showWeekends: true,
          phone: false,
        })}
        events={[]}
        settings={{
          initialView: 'timeGridWeek',
          showWeekends: true,
          weekStartsOn: 0,
          timeFormat: '24-hour',
          useNarrowDayHeaders: false,
          useNarrowEventContent: false,
        }}
      />
    ));
    expect(
      container.querySelector('.fc-day-today .calendar-day-header-date')
        ?.textContent
    ).toBe('2');
    setNow(new Date(2026, 10, 3, 0, 1));
    expect(
      container.querySelector('.fc-day-today .calendar-day-header-date')
        ?.textContent
    ).toBe('3');
    expect(
      container.querySelector<HTMLElement>('.calendar-light-now')?.style.top
    ).toBe(`${64 / 60}px`);
  });

  it('keeps the unsaved draft visible in the noninteractive projection', () => {
    const date = new Date(2026, 10, 2);
    const { container } = render(() => (
      <LightCalendarGrid
        date={date}
        now={date}
        dateInfo={calendarPageDateInfo(date, 'timeGridDay', {
          weekStartsOn: 0,
          showWeekends: true,
          phone: false,
        })}
        events={[]}
        settings={{
          initialView: 'timeGridDay',
          showWeekends: true,
          weekStartsOn: 0,
          timeFormat: '24-hour',
          useNarrowDayHeaders: false,
          useNarrowEventContent: false,
        }}
        draftRange={{
          start: new Date(2026, 10, 2, 9),
          end: new Date(2026, 10, 2, 10),
        }}
        selectionColor="blue"
      />
    ));
    const draft = container.querySelector('.calendar-day-draft');
    expect(draft).not.toBeNull();
    expect(draft?.parentElement?.style.top).toBe('576px');
    expect(draft?.parentElement?.style.height).toBe('64px');
    expect(
      container.querySelector('[data-calendar-renderer="interactive"]')
    ).toBeNull();
  });
});
