import { WheelColumn } from '@components/app/mobile/wheel-picker/WheelPicker';
import { WHEEL_ROW_HEIGHT } from '@components/app/mobile/wheel-picker/wheel-values';
import { Calendar, type DatesSetArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSnapPager } from '@ui/components/SnapPager/SnapPager';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarLoadingSkeleton } from '../../calendar-view/components/CalendarLoadingSkeleton';
import { createMonthWheelPicker } from '../primitives/create-month-wheel-picker';
import type { CalendarGridPeriodView } from '../types';
import {
  CalendarPagerContextProvider,
  useCalendarPager,
} from './CalendarPagerContext';

const device = vi.hoisted(() => ({ touch: true }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));
afterEach(() => {
  device.touch = true;
});

function mountCalendar(
  view: CalendarGridPeriodView = 'timeGridDay',
  restored?: {
    date: Date;
    scrollTop: number;
    laidOut?: boolean;
    loading?: boolean;
  }
) {
  const element = document.createElement('div');
  let laidOut = restored?.laidOut !== false;
  let pagerContext: ReturnType<typeof useCalendarPager>;
  const pages = new Map<
    number,
    { calendar: Calendar; element: HTMLDivElement }
  >();
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientWidth', {
    value: 100,
    configurable: true,
  });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 100, 0);
  viewport.scrollTo = vi.fn(
    (options?: ScrollToOptions | number, _y?: number) => {
      if (typeof options === 'object')
        viewport.scrollLeft = options.left ?? viewport.scrollLeft;
    }
  );
  let detachViewport: () => void;
  const scrollToTime = vi.fn();

  function Controls() {
    const pager = useCalendarPager();
    pagerContext = pager;
    onMount(() => {
      for (const page of pager.pager.pages()) {
        const id = page.key;
        const child = document.createElement('div');
        element.append(child);
        const [dateInfo, setDateInfo] = createSignal<DatesSetArg>();
        const calendar = new Calendar(child, {
          plugins: [timeGridPlugin, dayGridPlugin],
          initialView: view,
          views: {
            timeGridThreeDay: { type: 'timeGrid', duration: { days: 3 } },
          },
          datesSet: setDateInfo,
        });
        calendar.render();
        const scroller = child.querySelector<HTMLElement>(
          '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
        );
        if (scroller) {
          Object.defineProperty(scroller, 'clientHeight', {
            configurable: true,
            get: () => (laidOut ? 600 : 0),
          });
          Object.defineProperty(scroller, 'scrollHeight', {
            get: () => (laidOut ? 2000 : 0),
          });
          let scrollTop = 0;
          Object.defineProperty(scroller, 'scrollTop', {
            get: () => scrollTop,
            set: (value: number) => {
              scrollTop = laidOut ? value : 0;
            },
          });
        }
        vi.spyOn(calendar, 'scrollToTime').mockImplementation(scrollToTime);
        pages.set(id, { calendar, element: child });
        const unregister = pager.registerPage({
          id,
          api: () => calendar,
          dateInfo,
          element: () => child,
          data: {
            range: () => undefined,
            events: () => [],
            visibleEvents: () => [],
            eventsById: () => new Map(),
            isLoading: () => restored?.loading ?? false,
            isSyncing: () => false,
            get occurrencesQuery(): never {
              throw new Error('Date navigation must not read occurrences');
            },
          },
        });
        onCleanup(() => {
          unregister();
          pages.delete(id);
          calendar.destroy();
        });
      }
      detachViewport = pager.pager.attachViewport(viewport);
      onCleanup(() => detachViewport());
    });
    return (
      <>
        <CalendarLoadingSkeleton
          element={pager.activePage()?.element()}
          dateInfo={pager.activeDateInfo()}
          loading={restored?.loading ?? false}
          disabled={false}
        />
        <button onClick={pager.navigateToToday}>Today</button>
        <button onClick={() => pager.navigateToDate(new Date(2026, 10, 5))}>
          Another date
        </button>
        <button onClick={pager.nextPeriod}>Next period</button>
        {element}
      </>
    );
  }

  render(() => (
    <CalendarPagerContextProvider
      initialView={view}
      initialDate={restored?.date}
      initialScrollTop={restored?.scrollTop}
      showWeekends={() => true}
      weekStartsOn={() => 0}
      onNavigate={() => {}}
      onViewChange={() => {}}
    >
      <Controls />
    </CalendarPagerContextProvider>
  ));
  return {
    calendar: () => {
      const api = pagerContext.activePage()?.api();
      if (!api) throw new Error('Active calendar missing');
      return api;
    },
    pager: () => pagerContext,
    pages,
    viewport,
    scrollToTime,
    revealGrids: () => {
      laidOut = true;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 1, 13, 45));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('continuous virtual calendar track', () => {
  it.each([-1, 1])(
    'recycles seven real grids through thirty moving pages in direction %s',
    async (direction) => {
      const { pager, viewport, pages } = mountCalendar('dayGridMonth');
      const base = viewport.scrollLeft;
      const slots = pager().pager.pages();
      expect(slots).toHaveLength(7);
      const identities = [...pages.values()].map(({ calendar }) => calendar);
      for (let step = 1; step <= 30; step++) {
        const left = base + direction * step * 100;
        viewport.scrollLeft = left;
        viewport.dispatchEvent(new Event('scroll'));
        await vi.advanceTimersByTimeAsync(16);
        expect(pager().pager.position()).toBe(direction * step);
        expect(pager().navigationDate().getTime()).toBe(
          new Date(2026, 10 + direction * step, 1, 13, 45).getTime()
        );
        const assigned = slots
          .map((slot) => slot.position())
          .sort((a, b) => a - b);
        expect(assigned).toEqual(
          Array.from({ length: 7 }, (_, index) => direction * step - 3 + index)
        );
        for (const slot of slots) {
          expect(pages.get(slot.key)?.calendar.getDate().getMonth()).toBe(
            new Date(2026, 10 + slot.position(), 1).getMonth()
          );
        }
        expect(viewport.scrollLeft).toBe(left);
        expect(pager().pager.phase()).not.toBe('idle');
      }
      expect(pager().pager.pages()).toBe(slots);
      expect([...pages.values()].map(({ calendar }) => calendar)).toEqual(
        identities
      );
    }
  );

  it('updates the heading as the viewport centre crosses a fractional page', async () => {
    const { pager, viewport } = mountCalendar('dayGridMonth');
    const base = viewport.scrollLeft;
    viewport.scrollLeft = base + 49;
    viewport.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(16);
    expect(pager().navigationDate().getMonth()).toBe(10);
    viewport.scrollLeft = base + 51;
    viewport.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(16);
    expect(pager().navigationDate().getMonth()).toBe(11);
    expect(pager().pager.fractionalPosition()).toBeCloseTo(0.51);
    expect(viewport.scrollLeft).toBe(base + 51);
  });

  it('allows two native trackpad swipes with an overlapping momentum tail', async () => {
    device.touch = false;
    const { pager, viewport } = mountCalendar('dayGridMonth');
    const base = viewport.scrollLeft;
    for (const [delta, left] of [
      [70, 60],
      [30, 90],
      [9, 100],
      [65, 160],
      [24, 192],
      [8, 200],
    ]) {
      const wheel = new WheelEvent('wheel', {
        deltaX: delta,
        cancelable: true,
      });
      viewport.dispatchEvent(wheel);
      expect(wheel.defaultPrevented).toBe(false);
      viewport.scrollLeft = base + left;
      viewport.dispatchEvent(new Event('scroll'));
      await vi.advanceTimersByTimeAsync(16);
    }
    expect(pager().pager.position()).toBe(2);
    expect(pager().navigationDate().getMonth()).toBe(0);
    expect(viewport.scrollLeft).toBe(base + 200);
  });

  it('settles without scrollend and never recentres an ordinary swipe', async () => {
    const { pager, viewport } = mountCalendar('dayGridMonth');
    const left = viewport.scrollLeft + 100;
    viewport.scrollLeft = left;
    viewport.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(800);
    expect(pager().pager.phase()).toBe('idle');
    expect(pager().pager.position()).toBe(1);
    expect(viewport.scrollLeft).toBe(left);
  });

  it('finishes a smooth command and advances each rapid command immediately', () => {
    const { pager, viewport } = mountCalendar('dayGridMonth');
    const base = viewport.scrollLeft;
    pager().nextPeriod();
    pager().nextPeriod();
    expect(pager().pager.position()).toBe(2);
    expect(viewport.scrollLeft).toBe(base + 200);
    pager().previousPeriod();
    expect(pager().pager.position()).toBe(1);
    expect(pager().navigationDate().getMonth()).toBe(11);
  });

  it('does not depend on occurrence readiness when assigning a destination', () => {
    const { pager, calendar } = mountCalendar('timeGridDay', {
      date: new Date(2026, 10, 1),
      scrollTop: 0,
      loading: true,
    });
    pager().gotoDate(new Date(2026, 11, 20));
    expect(pager().navigationDate()).toEqual(new Date(2026, 11, 20));
    expect(calendar().getDate().getDate()).toBe(20);
    expect(pager().activeData()?.isLoading()).toBe(true);
  });

  it('does not retain a recycled range in page data', () => {
    const { pager, viewport } = mountCalendar('timeGridDay');
    const base = viewport.scrollLeft;
    viewport.scrollLeft = base + 900;
    viewport.dispatchEvent(new Event('scroll'));
    const current = pager().pager.position();
    for (const slot of pager().pager.pages()) {
      expect(pager().pageRange(slot.key).start.getDate()).toBe(
        1 + slot.position()
      );
    }
    expect(current).toBe(9);
  });
});

describe('calendar navigation and vertical state', () => {
  it('jumps to a date and scrolls Today without losing its time request', async () => {
    const { pager, calendar, scrollToTime } = mountCalendar();
    pager().gotoDate(new Date(2027, 0, 14));
    expect(calendar().getDate().getFullYear()).toBe(2027);
    pager().navigateToToday();
    await vi.advanceTimersByTimeAsync(32);
    expect(calendar().getDate().getMonth()).toBe(10);
    expect(scrollToTime).toHaveBeenCalledWith({ minutes: 765 });
  });
  it('cancels a pending Today scroll when another date is selected', async () => {
    const { pager, scrollToTime } = mountCalendar();
    pager().navigateToToday();
    pager().gotoDate(new Date(2027, 0, 14));
    await vi.advanceTimersByTimeAsync(32);
    expect(scrollToTime).not.toHaveBeenCalled();
  });
  it('rejects date and period navigation while editing locks paging', () => {
    const { pager } = mountCalendar('dayGridMonth');
    pager().setPagingLocked(true);
    pager().navigateToDate(new Date(2026, 11, 1));
    pager().gotoDate(new Date(2027, 0, 1));
    pager().nextPeriod();
    expect(pager().navigationDate().getMonth()).toBe(10);
  });
  it('copies vertical scroll to every slot and retains it across date recycling and resize', () => {
    const { pager, pages, viewport } = mountCalendar();
    const scroller = pager()
      .activePage()
      ?.element()
      ?.querySelector<HTMLElement>(
        '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
      );
    if (!scroller) throw new Error('Missing active hour scroller');
    scroller.scrollTop = 340;
    scroller.dispatchEvent(new Event('scroll'));
    viewport.scrollLeft += 800;
    viewport.dispatchEvent(new Event('scroll'));
    pager().updateSize();
    for (const { element } of pages.values()) {
      expect(
        element.querySelector<HTMLElement>(
          '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
        )?.scrollTop
      ).toBe(340);
    }
  });
  it('restores the saved date and vertical position into every mounted grid', () => {
    const { pager, pages } = mountCalendar('timeGridDay', {
      date: new Date(2027, 4, 3),
      scrollTop: 240,
    });
    expect(pager().navigationDate().getTime()).toBe(
      new Date(2027, 4, 3).getTime()
    );
    for (const { element } of pages.values()) {
      expect(
        element.querySelector<HTMLElement>(
          '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
        )?.scrollTop
      ).toBe(240);
    }
  });
});

describe('deferred layout and native date requests', () => {
  it.each([
    ['dayGridMonth', new Date(2026, 11, 15)],
    ['timeGridWeek', new Date(2026, 10, 10)],
  ] as const)(
    'retains the exact selected date in an adjacent %s',
    async (view, date) => {
      const { pager, calendar } = mountCalendar(view);
      pager().navigateToDate(date);
      await vi.advanceTimersByTimeAsync(400);
      expect(pager().navigationDate()).toEqual(date);
      expect(calendar().getDate()).toEqual(date);
    }
  );
  it('starts a three-day date selection at the exact selected day', () => {
    const { pager, calendar } = mountCalendar('timeGridThreeDay');
    pager().navigateToDate(new Date(2026, 10, 5));
    expect(pager().navigationDate()).toEqual(new Date(2026, 10, 5));
    expect(calendar().getDate().getDate()).toBe(5);
  });
  it('keeps a saved hour until initially hidden grids acquire geometry', () => {
    const { pager, pages, revealGrids } = mountCalendar('timeGridDay', {
      date: new Date(2027, 4, 3),
      scrollTop: 240,
      laidOut: false,
    });
    expect(pager().scrollTop()).toBe(240);
    revealGrids();
    pager().updateSize();
    for (const { element } of pages.values()) {
      expect(
        element.querySelector<HTMLElement>(
          '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
        )?.scrollTop
      ).toBe(240);
    }
  });

  it('retains the last date picked during native momentum without moving the track', async () => {
    const { pager, viewport, calendar } = mountCalendar('dayGridMonth');
    const left = viewport.scrollLeft + 70;
    viewport.scrollLeft = left;
    viewport.dispatchEvent(new Event('scroll'));
    pager().gotoDate(new Date(2027, 4, 1));
    pager().gotoDate(new Date(2028, 2, 1));
    expect(viewport.scrollLeft).toBe(left);
    await vi.advanceTimersByTimeAsync(800);
    expect(pager().navigationDate()).toEqual(new Date(2028, 2, 1));
    expect(calendar().getDate().getFullYear()).toBe(2028);
  });
});

describe('virtual track lifecycle', () => {
  it('executes a command after a stationary contact releases', async () => {
    const { pager, viewport } = mountCalendar('dayGridMonth');
    const origin = viewport.scrollLeft;
    viewport.dispatchEvent(new Event('touchstart'));
    pager().nextPeriod();
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    await vi.advanceTimersByTimeAsync(800);
    expect(pager().pager.position()).toBe(1);
    expect(viewport.scrollLeft).toBe(origin + 100);
  });

  it('resumes alignment after a contact locks before moving and hides', async () => {
    let width = 100;
    const viewport = document.createElement('div');
    Object.defineProperty(viewport, 'clientWidth', { get: () => width });
    viewport.getBoundingClientRect = () => new DOMRect(0, 0, width, 0);
    const pager = createSnapPager();
    const detach = pager.attachViewport(viewport);
    try {
      const origin = viewport.scrollLeft;
      viewport.dispatchEvent(new Event('touchstart'));
      pager.setLocked(true);
      width = 0;
      viewport.scrollLeft = 0;
      pager.resize();
      pager.setLocked(false);
      window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
      await vi.advanceTimersByTimeAsync(500);
      width = 100;
      pager.resize();
      await vi.advanceTimersByTimeAsync(800);
      expect(viewport.scrollLeft).toBe(origin);
      viewport.scrollLeft = origin + 100;
      viewport.dispatchEvent(new Event('scroll'));
      expect(pager.position()).toBe(1);
    } finally {
      detach();
    }
  });

  it('lets a new contact cancel a far date selected during momentum', async () => {
    const { pager, viewport } = mountCalendar('dayGridMonth');
    const origin = viewport.scrollLeft;
    viewport.dispatchEvent(new Event('touchstart'));
    viewport.scrollLeft = origin + 70;
    viewport.dispatchEvent(new Event('scroll'));
    pager().gotoDate(new Date(2030, 4, 1));
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    viewport.dispatchEvent(new Event('touchstart'));
    viewport.scrollLeft = origin + 200;
    viewport.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    await vi.advanceTimersByTimeAsync(800);
    expect(pager().navigationDate().getFullYear()).toBe(2027);
    expect(pager().navigationDate().getMonth()).toBe(0);
  });

  it('does not resume a queued command invalidated by a far-date settlement', async () => {
    const { pager, viewport } = mountCalendar('dayGridMonth');
    viewport.dispatchEvent(new Event('touchstart'));
    viewport.scrollLeft += 70;
    viewport.dispatchEvent(new Event('scroll'));
    pager().nextPeriod();
    pager().gotoDate(new Date(2030, 4, 1));
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    await vi.advanceTimersByTimeAsync(800);
    expect(pager().navigationDate()).toEqual(new Date(2030, 4, 1));
    expect(Number.isFinite(viewport.scrollLeft)).toBe(true);
  });
  it('lets a later touch supersede a command queued during momentum', async () => {
    const { pager, viewport } = mountCalendar('dayGridMonth');
    const origin = viewport.scrollLeft;
    viewport.dispatchEvent(new Event('touchstart'));
    viewport.scrollLeft = origin + 70;
    viewport.dispatchEvent(new Event('scroll'));
    pager().previousPeriod();
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    viewport.dispatchEvent(new Event('touchstart'));
    viewport.scrollLeft = origin + 300;
    viewport.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    await vi.advanceTimersByTimeAsync(800);
    expect(pager().pager.position()).toBe(3);
    expect(viewport.scrollLeft).toBe(origin + 300);
  });

  it('does not treat a locked contact as a new swipe after release', async () => {
    const { pager, viewport } = mountCalendar('dayGridMonth');
    const origin = viewport.scrollLeft;
    viewport.dispatchEvent(new Event('touchstart'));
    pager().setPagingLocked(true);
    viewport.scrollLeft = origin + 80;
    viewport.dispatchEvent(new Event('scroll'));
    pager().setPagingLocked(false);
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    await vi.advanceTimersByTimeAsync(800);
    expect(pager().pager.position()).toBe(0);
    expect(viewport.scrollLeft).toBe(origin);
  });
  it('does not enter horizontal motion for a stationary or vertical contact', async () => {
    const pager = createSnapPager();
    const viewport = document.createElement('div');
    Object.defineProperty(viewport, 'clientWidth', { value: 100 });
    viewport.getBoundingClientRect = () => new DOMRect(0, 0, 100, 0);
    const detach = pager.attachViewport(viewport);
    try {
      viewport.dispatchEvent(new Event('touchstart'));
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 80 }));
      await vi.advanceTimersByTimeAsync(64);
      expect(pager.phase()).toBe('idle');
      expect(pager.nativeScrolling()).toBe(false);
      window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    } finally {
      detach();
    }
  });

  it.each([false, true])(
    'resumes a hidden viewport after a locked native contact (queued=%s)',
    async (queued) => {
      let width = 100;
      const viewport = document.createElement('div');
      Object.defineProperty(viewport, 'clientWidth', { get: () => width });
      viewport.getBoundingClientRect = () => new DOMRect(0, 0, width, 0);
      viewport.scrollTo = (options?: ScrollToOptions | number) => {
        if (typeof options === 'object')
          viewport.scrollLeft = options.left ?? viewport.scrollLeft;
      };
      const pager = createSnapPager();
      const detach = pager.attachViewport(viewport);
      try {
        const origin = viewport.scrollLeft;
        viewport.dispatchEvent(new Event('touchstart'));
        viewport.scrollLeft = origin + 170;
        viewport.dispatchEvent(new Event('scroll'));
        pager.setLocked(true);
        width = 0;
        viewport.scrollLeft = 0;
        pager.resize();
        pager.setLocked(false);
        if (queued) pager.goTo(3);
        window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
        await vi.advanceTimersByTimeAsync(500);
        width = 100;
        pager.resize();
        await vi.advanceTimersByTimeAsync(800);
        expect(pager.position()).toBe(queued ? 5 : 2);
        expect(pager.phase()).toBe('idle');
        expect(viewport.scrollLeft).toBe(origin + (queued ? 500 : 200));
      } finally {
        detach();
      }
    }
  );
});

describe('phone month/year selector alignment', () => {
  it('does not navigate to an old snap target when mounting or changing the year', async () => {
    const offsets = new WeakMap<Element, number>();
    vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(
      function (this: Element) {
        return offsets.get(this) ?? 0;
      }
    );
    vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(
      function (this: Element, value: number) {
        let target = value;
        // Model mandatory native snap against the rows mounted at the write.
        if (
          this.classList.contains('wheel-picker-column') &&
          this instanceof HTMLElement &&
          this.style.scrollSnapType !== 'none'
        ) {
          const points = [
            ...this.querySelectorAll<HTMLElement>('.wheel-picker-row'),
          ].map((row) => Number.parseFloat(row.style.top));
          if (points.length)
            target = points.reduce((closest, point) =>
              Math.abs(point - value) < Math.abs(closest - value)
                ? point
                : closest
            );
        }
        offsets.set(this, target);
      }
    );
    const { pager } = mountCalendar('dayGridMonth');
    const picker = createMonthWheelPicker(
      new Date(2026, 10, 1),
      pager().navigateToDate
    );
    const years = Array.from({ length: 131 }, (_, index) => ({
      value: String(1970 + index),
      label: String(1970 + index),
    }));
    render(() => (
      <WheelColumn
        label="Year"
        options={years}
        value={String(picker.year())}
        onChange={(value) => picker.selectYear(Number(value))}
        width={72}
      />
    ));
    const year = screen.getByRole('spinbutton', { name: 'Year' });
    fireEvent.scroll(year);
    await vi.advanceTimersByTimeAsync(500);
    expect(picker.year()).toBe(2026);
    expect(pager().navigationDate().getFullYear()).toBe(2026);
    expect(year.scrollTop).toBe((2026 - 1970) * WHEEL_ROW_HEIGHT);
    expect(year.style.scrollSnapType).toBe('');

    picker.selectYear(2040);
    fireEvent.scroll(year);
    await vi.advanceTimersByTimeAsync(500);
    expect(picker.year()).toBe(2040);
    expect(pager().activeDate().getFullYear()).toBe(2040);
    expect(year.scrollTop).toBe((2040 - 1970) * WHEEL_ROW_HEIGHT);
    expect(year.style.scrollSnapType).toBe('');
  });
});
