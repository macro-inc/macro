import { FullCalendar, useFullCalendar } from '@app/lib/fullcalendar-solid';
import type { EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarPeriodView } from '../../calendar/types';
import { CalendarLoadingSkeleton } from './CalendarLoadingSkeleton';

let resizeCallbacks: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  resizeCallbacks = [];
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1)
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(() => callback([], this));
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountSkeleton(initialView: CalendarPeriodView = 'timeGridWeek') {
  const [loading, setLoading] = createSignal(true);
  const [disabled, setDisabled] = createSignal(false);
  const [blocking, setBlocking] = createSignal(false);
  const [events, setEvents] = createSignal<EventInput[]>([
    {
      id: 'real-event',
      title: 'Real event',
      start: '2026-09-28T10:00:00',
      end: '2026-09-28T11:00:00',
    },
  ]);
  let calendar!: ReturnType<typeof useFullCalendar>;
  function Host() {
    calendar = useFullCalendar();
    const [element, setElement] = createSignal<HTMLDivElement>();
    return (
      <>
        <FullCalendar.Host ref={setElement} />
        <CalendarLoadingSkeleton
          element={element()}
          dateInfo={calendar.dateInfo()}
          loading={loading()}
          disabled={disabled()}
          onBlockingChange={setBlocking}
        />
      </>
    );
  }
  const mounted = render(() => (
    <FullCalendar.Root
      plugins={[dayGridPlugin, timeGridPlugin]}
      initialView={initialView}
      initialDate="2026-09-28"
      headerToolbar={false}
      handleWindowResize={false}
      weekends={false}
      events={loading() ? [] : events()}
    >
      <Host />
    </FullCalendar.Root>
  ));
  const skeletons = () =>
    mounted.container.querySelectorAll<HTMLElement>(
      '[data-calendar-loading-skeleton]'
    );
  const host = () =>
    mounted.container.querySelector<HTMLElement>(
      '[data-calendar-loading-state]'
    )!;
  return {
    ...mounted,
    calendar,
    setLoading,
    setDisabled,
    setEvents,
    blocking,
    skeletons,
    host,
  };
}

const placeholders = (element: HTMLElement, kind: 'timed' | 'bar' | 'dot') => [
  ...element.querySelectorAll<HTMLElement>(
    `[data-calendar-loading-placeholder="${kind}"]`
  ),
];

const timedPattern = (column: HTMLElement) =>
  placeholders(column, 'timed').map((placeholder) => ({
    time: placeholder.dataset.calendarLoadingTime,
    top: placeholder.style.top,
    height: placeholder.style.height,
  }));

describe('CalendarLoadingSkeleton', () => {
  it('skips skeletons for quick loads', () => {
    const grid = mountSkeleton();
    vi.advanceTimersByTime(60);
    grid.setLoading(false);
    vi.runAllTimers();
    expect(grid.skeletons()).toHaveLength(0);
    expect(grid.host().dataset.calendarLoadingState).toBe('hidden');
    expect(grid.container.textContent).toContain('Real event');
  });

  it('decorates the live visible columns without replacing the grid or adding events', () => {
    const grid = mountSkeleton();
    const calendarElement = grid.container.querySelector('.fc');
    const dayHeaders = grid.container.querySelectorAll('.fc-col-header-cell');
    vi.advanceTimersByTime(120);
    const timed = [...grid.skeletons()].filter(
      (el) => el.dataset.calendarLoadingSkeleton === 'timed'
    );
    expect(timed).toHaveLength(5);
    expect(timed.every((el) => el.closest('.fc-timegrid-col-frame'))).toBe(
      true
    );
    const allDay = [...grid.skeletons()].filter(
      (el) => el.dataset.calendarLoadingSkeleton === 'all-day'
    );
    expect(allDay.length).toBeGreaterThan(0);
    expect(
      [...grid.skeletons()].every(
        (el) => el.getAttribute('aria-hidden') === 'true'
      )
    ).toBe(true);
    expect(grid.calendar.api()?.getEvents()).toHaveLength(0);
    expect(grid.container.querySelector('.fc')).toBe(calendarElement);
    expect([...grid.container.querySelectorAll('.fc-col-header-cell')]).toEqual(
      [...dayHeaders]
    );
  });

  it('uses sparse, varied timed placeholders aligned with measured slots', () => {
    const slotHeight = 24;
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (!this.matches('.fc-timegrid-slot-lane[data-time]')) {
          return originalBounds.call(this);
        }
        const [hour, minute] = this.dataset.time!.split(':').map(Number);
        return new DOMRect(
          0,
          (hour * 2 + minute / 30) * slotHeight,
          100,
          slotHeight
        );
      }
    );
    const grid = mountSkeleton();
    vi.advanceTimersByTime(120);
    const slots = [
      ...grid.container.querySelectorAll<HTMLElement>(
        '.fc-timegrid-slot-lane[data-time]'
      ),
    ];
    const columns = [
      ...grid.container.querySelectorAll<HTMLElement>(
        '.fc-timegrid-col[data-date]:not(.fc-day-disabled)'
      ),
    ];
    expect(columns).toHaveLength(5);
    const patterns = columns.map(timedPattern);
    expect(
      patterns.every(
        (pattern) => pattern.length > 0 && pattern.length < slots.length
      )
    ).toBe(true);
    expect(
      new Set(patterns.flatMap((pattern) => pattern.map((p) => p.height))).size
    ).toBeGreaterThan(1);
    const slotTimes = new Set(slots.map((slot) => slot.dataset.time));
    for (const pattern of patterns) {
      for (const placeholder of pattern) {
        expect(slotTimes.has(placeholder.time)).toBe(true);
        expect(Number.parseFloat(placeholder.height)).toBeGreaterThan(0);
        expect((Number.parseFloat(placeholder.height) + 4) % slotHeight).toBe(
          0
        );
        const [hour, minute] = placeholder.time!.split(':').map(Number);
        expect(placeholder.top).toBe(
          `${(hour * 2 + minute / 30) * slotHeight + 2}px`
        );
      }
    }
    grid.calendar.api()?.changeView('timeGridDay', columns[0]!.dataset.date);
    const sameDay = grid.container.querySelector<HTMLElement>(
      '.fc-timegrid-col[data-date]:not(.fc-day-disabled)'
    )!;
    expect(timedPattern(sameDay)).toEqual(patterns[0]);
    expect(grid.calendar.api()?.getEvents()).toHaveLength(0);
    expect(grid.container.querySelectorAll('.fc-event')).toHaveLength(0);
  });

  it('keeps Week-to-Day positions and patterns stable for the same date', () => {
    const grid = mountSkeleton();
    vi.advanceTimersByTime(120);
    const monday = grid.container.querySelector<HTMLElement>(
      '.fc-timegrid-col[data-date="2026-09-28"]'
    )!;
    const before = timedPattern(monday);
    const allDayBefore = placeholders(
      grid.container.querySelector<HTMLElement>(
        '.fc-daygrid-day[data-date="2026-09-28"]'
      )!,
      'bar'
    ).map((bar) => bar.outerHTML);
    expect(before.length).toBeGreaterThan(0);
    grid.calendar.api()?.changeView('timeGridDay', '2026-09-28');
    const day = grid.container.querySelector<HTMLElement>(
      '.fc-timegrid-col[data-date="2026-09-28"]'
    )!;
    expect(timedPattern(day)).toEqual(before);
    expect(
      placeholders(
        grid.container.querySelector<HTMLElement>(
          '.fc-daygrid-day[data-date="2026-09-28"]'
        )!,
        'bar'
      ).map((bar) => bar.outerHTML)
    ).toEqual(allDayBefore);
  });

  it('renders all-day bars only and leaves some dates empty', () => {
    const grid = mountSkeleton();
    vi.advanceTimersByTime(120);
    const allDay = [...grid.skeletons()].filter(
      (el) => el.dataset.calendarLoadingSkeleton === 'all-day'
    );
    expect(allDay.length).toBeGreaterThan(0);
    expect(allDay.some((day) => placeholders(day, 'bar').length > 0)).toBe(
      true
    );
    expect(allDay.length).toBeLessThan(5);
    expect(allDay.every((day) => placeholders(day, 'dot').length === 0)).toBe(
      true
    );
  });

  it('preserves unchanged overlays and rebuilds them after slot resizing', () => {
    let slotHeight = 20;
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (!this.matches('.fc-timegrid-slot-lane[data-time]')) {
          return originalBounds.call(this);
        }
        const [hour, minute] = this.dataset.time!.split(':').map(Number);
        return new DOMRect(
          0,
          (hour * 2 + minute / 30) * slotHeight,
          100,
          slotHeight
        );
      }
    );
    const grid = mountSkeleton();
    vi.advanceTimersByTime(120);
    const timed = [...grid.skeletons()].filter(
      (el) => el.dataset.calendarLoadingSkeleton === 'timed'
    );
    const before = timed.map(timedPattern);
    const dateInfo = grid.calendar.dateInfo();
    const notifyResize = resizeCallbacks.at(-1)!;
    notifyResize();
    vi.advanceTimersByTime(0);
    expect(
      [...grid.skeletons()].filter(
        (el) => el.dataset.calendarLoadingSkeleton === 'timed'
      )
    ).toEqual(timed);
    slotHeight = 36;
    notifyResize();
    vi.advanceTimersByTime(0);
    const resized = [...grid.skeletons()].filter(
      (el) => el.dataset.calendarLoadingSkeleton === 'timed'
    );
    expect(resized).toHaveLength(5);
    expect(resized.some((node, index) => node !== timed[index])).toBe(true);
    expect(
      resized.map(timedPattern).map((pattern) => pattern.map((p) => p.top))
    ).not.toEqual(before.map((pattern) => pattern.map((p) => p.top)));
    expect(grid.calendar.dateInfo()).toBe(dateInfo);
  });

  it('renders real events underneath retained skeletons before fading them out', () => {
    const grid = mountSkeleton();
    vi.advanceTimersByTime(120);
    const placeholders = [...grid.skeletons()];
    vi.advanceTimersByTime(40);
    grid.setLoading(false);
    vi.advanceTimersByTime(0);
    expect(grid.container.textContent).toContain('Real event');
    expect(grid.skeletons().length).toBeGreaterThan(0);
    expect(grid.host().dataset.calendarLoadingState).toBe('visible');
    expect(grid.blocking()).toBe(true);
    vi.advanceTimersByTime(199);
    expect(grid.host().dataset.calendarLoadingState).toBe('visible');
    expect(
      [...grid.skeletons()].every((el) => el.dataset.state === 'visible')
    ).toBe(true);
    vi.advanceTimersByTime(1);
    expect(
      [...grid.skeletons()].every((el) => el.dataset.state === 'leaving')
    ).toBe(true);
    expect(grid.host().dataset.calendarLoadingState).toBe('revealing');
    expect(grid.blocking()).toBe(false);
    expect(
      [...grid.skeletons()].every((el, index) => el === placeholders[index])
    ).toBe(true);
    vi.advanceTimersByTime(180);
    expect(grid.skeletons()).toHaveLength(0);
    expect(grid.container.textContent).toContain('Real event');
  });
  it('finishes an empty range without keeping fake events in the grid', () => {
    const grid = mountSkeleton('timeGridDay');
    grid.setEvents([]);
    vi.advanceTimersByTime(400);
    grid.setLoading(false);
    vi.advanceTimersByTime(0);
    expect(grid.skeletons().length).toBeGreaterThan(0);
    expect(grid.container.querySelectorAll('.fc-event')).toHaveLength(0);
    vi.advanceTimersByTime(180);
    expect(grid.skeletons()).toHaveLength(0);
    expect(grid.calendar.api()?.getEvents()).toHaveLength(0);
  });

  it('does not replay skeletons or entrance animations for ready-data updates', () => {
    const grid = mountSkeleton();
    grid.setLoading(false);
    vi.runAllTimers();
    grid.setEvents([
      {
        id: 'refreshed-event',
        title: 'Refreshed event',
        start: '2026-09-28T12:00:00',
      },
    ]);
    vi.runAllTimers();
    expect(grid.container.textContent).toContain('Refreshed event');
    expect(grid.skeletons()).toHaveLength(0);
    expect(grid.host().dataset.calendarLoadingState).toBe('hidden');
  });

  it('moves visible skeletons into new month cells without restarting the loading delay', () => {
    const grid = mountSkeleton();
    vi.advanceTimersByTime(120);
    vi.advanceTimersByTime(500);
    grid.calendar.api()?.changeView('dayGridMonth');
    expect(grid.host().dataset.calendarLoadingState).toBe('visible');
    expect(grid.skeletons().length).toBeGreaterThan(0);
    expect(
      [...grid.skeletons()].every(
        (el) => el.dataset.calendarLoadingSkeleton === 'month'
      )
    ).toBe(true);
    expect(
      [...grid.skeletons()].every((el) => el.closest('.fc-daygrid-day'))
    ).toBe(true);
    expect(
      grid.container.querySelectorAll(
        '[data-calendar-loading-skeleton="timed"]'
      )
    ).toHaveLength(0);
    const eligibleDays = grid.container.querySelectorAll(
      '.fc-daygrid-day[data-date]:not(.fc-day-disabled)'
    );
    const selectedDays = [...grid.skeletons()];
    expect(selectedDays).toHaveLength(eligibleDays.length);
    expect(
      selectedDays.some((day) => placeholders(day, 'bar').length > 0)
    ).toBe(true);
    expect(
      selectedDays.some((day) => placeholders(day, 'dot').length > 0)
    ).toBe(true);
    expect(
      selectedDays.every((day) => day.querySelector('.fc-event') === null)
    ).toBe(true);
    expect(grid.container.querySelectorAll('.fc-event')).toHaveLength(0);
    grid.setLoading(false);
    vi.advanceTimersByTime(0);
    expect(grid.host().dataset.calendarLoadingState).toBe('revealing');
    expect(
      [...grid.skeletons()].every((el) => el.dataset.state === 'leaving')
    ).toBe(true);
  });

  it('mixes month bars and simple text lines below day headers', () => {
    let headerHeight = 30;
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.matches('.fc-daygrid-day-top')) {
          return new DOMRect(0, 0, 100, headerHeight);
        }
        if (this.matches('.fc-daygrid-day[data-date]')) {
          return new DOMRect(0, 0, 100, 140);
        }
        return originalBounds.call(this);
      }
    );
    const grid = mountSkeleton('dayGridMonth');
    vi.advanceTimersByTime(120);
    const days = [
      ...grid.container.querySelectorAll<HTMLElement>(
        '.fc-daygrid-day[data-date]:not(.fc-day-disabled)'
      ),
    ];
    expect(days.length).toBeGreaterThan(5);
    const patterns = days.map((day) => {
      const overlay = day.querySelector<HTMLElement>(
        '[data-calendar-loading-skeleton="month"]'
      )!;
      const bars = placeholders(overlay, 'bar');
      const dots = placeholders(overlay, 'dot');
      const header = day.querySelector('.fc-daygrid-day-top')!;
      expect(overlay.contains(header)).toBe(false);
      for (const placeholder of [...bars, ...dots]) {
        expect(Number.parseFloat(placeholder.style.top)).toBeGreaterThan(
          headerHeight
        );
      }
      expect(dots.every((dot) => !dot.classList.contains('bg-skeleton'))).toBe(
        true
      );
      for (const dot of dots) {
        const row = dot.firstElementChild!;
        expect(row.children).toHaveLength(1);
        expect(row.querySelector('[data-calendar-loading-dot]')).toBeNull();
        expect(row.firstElementChild?.classList.contains('h-2')).toBe(true);
        expect(
          row.firstElementChild?.classList.contains('bg-skeleton/70')
        ).toBe(true);
      }
      expect(
        header.compareDocumentPosition(overlay) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      return `${bars.length}:${dots.length}`;
    });
    expect(new Set(patterns).size).toBeGreaterThan(1);
    expect(patterns.some((pattern) => pattern.startsWith('0:'))).toBe(true);
    expect(patterns.some((pattern) => !pattern.startsWith('0:'))).toBe(true);
    const first = days[0]!.querySelector<HTMLElement>(
      '[data-calendar-loading-skeleton="month"]'
    )!;
    const notifyResize = resizeCallbacks.at(-1)!;
    notifyResize();
    vi.advanceTimersByTime(0);
    expect(
      days[0]!.querySelector('[data-calendar-loading-skeleton="month"]')
    ).toBe(first);
    headerHeight = 48;
    notifyResize();
    vi.advanceTimersByTime(0);
    const resized = days[0]!.querySelector<HTMLElement>(
      '[data-calendar-loading-skeleton="month"]'
    )!;
    expect(resized).not.toBe(first);
    expect(
      Number.parseFloat(
        placeholders(resized, 'bar')[0]?.style.top ??
          placeholders(resized, 'dot')[0]!.style.top
      )
    ).toBeGreaterThan(headerHeight);
  });

  it('clears obsolete skeletons immediately for errors or unsupported ranges', () => {
    const grid = mountSkeleton();
    vi.advanceTimersByTime(120);
    grid.setDisabled(true);
    expect(grid.skeletons()).toHaveLength(0);
    expect(grid.host().dataset.calendarLoadingState).toBe('hidden');
    vi.runAllTimers();
    expect(grid.skeletons()).toHaveLength(0);
  });

  it('removes portal decorations and pending timers on unmount', () => {
    const grid = mountSkeleton();
    vi.advanceTimersByTime(120);
    const host = grid.host();
    grid.unmount();
    expect(
      host.querySelectorAll('[data-calendar-loading-skeleton]')
    ).toHaveLength(0);
    expect(host.dataset.calendarLoadingState).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
