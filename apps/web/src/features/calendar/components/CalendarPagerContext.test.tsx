import { Calendar, type DatesSetArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarGridPeriodView } from '../types';
import {
  applyTimeGridOpeningScroll,
  TIME_GRID_OPENING_SCROLL_TIME,
} from '../utils/time-grid-scroller';
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
  restored?: { date: Date; scrollTop: number; laidOut?: boolean }
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
      for (const id of [0, 1, 2, 3, 4]) {
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
            isLoading: () => false,
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

describe('calendar page start dates', () => {
  it('starts a late neighbor beside the period the active page moved to', async () => {
    const { pager } = mountCalendar('timeGridDay');
    fireEvent.click(screen.getByRole('button', { name: 'Another date' }));
    await vi.advanceTimersByTimeAsync(300);

    expect(pager().initialDateFor(1).getDate()).toBe(4);
    expect(pager().initialDateFor(3).getDate()).toBe(6);
  });
});

describe('calendar Today navigation', () => {
  it.each(['timeGridDay', 'timeGridWeek'] as const)(
    'scrolls to the current time even when already on today in %s',
    async (view) => {
      const { calendar, scrollToTime } = mountCalendar(view);
      fireEvent.click(screen.getByRole('button', { name: 'Today' }));
      expect(scrollToTime).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);
      expect(calendar().getDate().getDate()).toBe(1);
      expect(scrollToTime).toHaveBeenCalledWith({ minutes: 765 });
    }
  );

  it('returns from another date before scrolling to the current time', async () => {
    const { calendar, scrollToTime } = mountCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Another date' }));
    await vi.advanceTimersByTimeAsync(300);
    expect(calendar().getDate().getDate()).toBe(5);
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await vi.advanceTimersByTimeAsync(300);
    expect(calendar().getDate().getDate()).toBe(1);
    expect(scrollToTime).toHaveBeenCalledWith({ minutes: 765 });
  });

  it('clamps the context above the current time to midnight', async () => {
    vi.setSystemTime(new Date(2026, 10, 1, 0, 15));
    const { scrollToTime } = mountCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await vi.advanceTimersByTimeAsync(300);
    expect(scrollToTime).toHaveBeenCalledWith({ minutes: 0 });
  });

  it('cancels a pending Today scroll when another date is selected', async () => {
    const { calendar, scrollToTime } = mountCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    fireEvent.click(screen.getByRole('button', { name: 'Another date' }));
    await vi.advanceTimersByTimeAsync(300);
    expect(calendar().getDate().getDate()).toBe(5);
    expect(scrollToTime).not.toHaveBeenCalled();
  });

  it('cancels a pending Today scroll when paging forward', async () => {
    const { calendar, scrollToTime, viewport } = mountCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    viewport.dispatchEvent(new Event('scrollend'));
    await vi.advanceTimersByTimeAsync(300);
    expect(calendar().getDate().getDate()).toBe(2);
    expect(scrollToTime).not.toHaveBeenCalled();
  });
});

// Native scroll events commit the same five mounted FullCalendar instances used by the workspace.
describe('calendar native paging', () => {
  it('pages many months both ways without recycling during phone momentum', async () => {
    const { pager, calendar, viewport, pages } = mountCalendar('dayGridMonth');
    Object.defineProperty(viewport, 'onscrollend', { value: null });
    await vi.advanceTimersByTimeAsync(300);
    const mounted = [...pages.values()].map(({ calendar }) => calendar);
    viewport.dispatchEvent(new Event('touchstart'));
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    await vi.advanceTimersByTimeAsync(150);
    expect(pager().pager.phase()).toBe('idle');
    let offset = 0;
    for (const direction of [
      1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, 1,
      1, 1, 1,
    ]) {
      const before = pager().pager.position();
      viewport.dispatchEvent(new Event('touchstart'));
      viewport.scrollLeft = 200 + direction * 70;
      viewport.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
      await vi.advanceTimersByTimeAsync(260);
      expect(pager().pager.position()).toBe(before);
      viewport.dispatchEvent(new Event('scrollend'));
      viewport.dispatchEvent(new Event('scrollend'));
      await vi.advanceTimersByTimeAsync(150);
      offset += direction;
      const expected = new Date(2026, 10 + offset, 1);
      expect(calendar().view.currentStart.getTime()).toBe(expected.getTime());
      expect(pager().activeDate().getMonth()).toBe(expected.getMonth());
      expect(calendar().view.activeStart <= expected).toBe(true);
      expect(calendar().view.activeEnd > expected).toBe(true);
      expect([...pages.values()].map(({ calendar }) => calendar)).toEqual(
        mounted
      );
    }
    expect(pager().pager.position()).toBe(0);
  });
  it('pauses queued FullCalendar date changes through a long native scroll pause', async () => {
    const { pages, viewport, pager } = mountCalendar();
    Object.defineProperty(viewport, 'onscrollend', { value: null });
    const changes = [...pages.values()].map(({ calendar }) =>
      vi.spyOn(calendar, 'gotoDate')
    );
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaX: 60 }));
    viewport.scrollLeft = 300;
    viewport.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(500);
    expect(pager().pager.position()).toBe(0);
    for (const change of changes) expect(change).not.toHaveBeenCalled();
    viewport.dispatchEvent(new Event('scrollend'));
    await vi.advanceTimersByTimeAsync(100);
    expect(pager().pager.position()).toBe(1);
    expect(changes.some((change) => change.mock.calls.length > 0)).toBe(true);
  });
  it.each([
    ['timeGridDay', new Date(2026, 10, 2), new Date(2026, 10, 3)],
    ['timeGridWeek', new Date(2026, 10, 8), new Date(2026, 10, 15)],
    ['dayGridMonth', new Date(2026, 11, 1), new Date(2027, 0, 1)],
    ['timeGridThreeDay', new Date(2026, 10, 4), new Date(2026, 10, 7)],
  ] as const)(
    'settles forward and back in %s',
    async (view, firstDate, secondDate) => {
      const { pager, pages, viewport, calendar } = mountCalendar(view);
      const mounted = [...pages.values()].map(({ calendar }) => calendar);
      viewport.scrollLeft = 300;
      viewport.dispatchEvent(new Event('scrollend'));
      expect(pager().pager.position()).toBe(1);
      expect(pager().activeDate().toDateString()).toBe(
        firstDate.toDateString()
      );
      await vi.advanceTimersByTimeAsync(200);
      expect(calendar().getDate().toDateString()).toBe(
        firstDate.toDateString()
      );
      viewport.scrollLeft = 300;
      viewport.dispatchEvent(new Event('scrollend'));
      await vi.advanceTimersByTimeAsync(200);
      expect(calendar().getDate().toDateString()).toBe(
        secondDate.toDateString()
      );
      viewport.scrollLeft = 100;
      viewport.dispatchEvent(new Event('scrollend'));
      expect(pager().pager.position()).toBe(1);
      await vi.advanceTimersByTimeAsync(200);
      expect(calendar().getDate().toDateString()).toBe(
        firstDate.toDateString()
      );
      expect([...pages.values()].map(({ calendar }) => calendar)).toEqual(
        mounted
      );
    }
  );

  it('settles consecutive swipes before recycled buffer jobs execute', async () => {
    const { pager, pages, viewport } = mountCalendar();
    viewport.scrollLeft = 300;
    viewport.dispatchEvent(new Event('scrollend'));
    viewport.scrollLeft = 300;
    viewport.dispatchEvent(new Event('scrollend'));
    expect(pager().pager.position()).toBe(2);
    expect(pager().activeDate().getDate()).toBe(3);
    await vi.advanceTimersByTimeAsync(200);
    for (const [id, { calendar }] of pages) {
      const date = new Date(2026, 10, 3 + pager().pager.pages()[id].offset());
      expect(calendar.getDate().toDateString()).toBe(date.toDateString());
    }
  });

  it('copies the active hour scroll position to neighboring time grids', async () => {
    const { pager, pages, viewport } = mountCalendar();
    const scroller = pages
      .get(pager().activePageId())
      ?.element.querySelector<HTMLElement>(
        '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
      );
    expect(scroller).toBeTruthy();
    if (!scroller) throw new Error('Active time grid missing');
    scroller.scrollTop = 420;
    scroller.dispatchEvent(new Event('scroll'));
    for (const [id, { element }] of pages) {
      if (id === pager().activePageId()) continue;
      expect(
        element.querySelector(
          '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
        )?.scrollTop
      ).toBe(420);
    }
    viewport.scrollLeft = 300;
    viewport.dispatchEvent(new Event('scrollend'));
    await vi.advanceTimersByTimeAsync(200);
    expect(
      pages
        .get(pager().activePageId())
        ?.element.querySelector(
          '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
        )?.scrollTop
    ).toBe(420);
  });

  it.each([
    ['timeGridDay', 2],
    ['timeGridWeek', 8],
    ['dayGridMonth', 1],
  ] as const)(
    'keeps the active %s period and hour after split and window resize',
    async (view, day) => {
      const { pager, pages, viewport, calendar } = mountCalendar(view);
      viewport.scrollLeft = 300;
      viewport.dispatchEvent(new Event('scrollend'));
      await vi.advanceTimersByTimeAsync(200);
      const date = calendar().getDate().toDateString();
      const active = pages
        .get(pager().activePageId())
        ?.element.querySelector<HTMLElement>(
          '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
        );
      if (view !== 'dayGridMonth') {
        if (!active) throw new Error('Active time grid missing');
        active.scrollTop = 480;
        active.dispatchEvent(new Event('scroll'));
        // FullCalendar can reset its internal hour scroller during updateSize.
        for (const { calendar: api, element } of pages.values()) {
          const scroller = element.querySelector<HTMLElement>(
            '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
          );
          vi.spyOn(api, 'updateSize').mockImplementation(() => {
            if (scroller) scroller.scrollTop = 0;
          });
        }
      }
      for (const width of [160, 240]) {
        Object.defineProperty(viewport, 'clientWidth', {
          value: width,
          configurable: true,
        });
        viewport.dispatchEvent(new Event('scroll'));
        pager().pager.resize();
        pager().updateSize();
        expect(viewport.scrollLeft).toBe(width * 2);
        expect(pager().pager.position()).toBe(1);
        expect(pager().activeDate().getDate()).toBe(day);
        expect(calendar().getDate().toDateString()).toBe(date);
        if (active) expect(active.scrollTop).toBe(480);
      }
    }
  );

  it('keeps the last hour when FullCalendar resets the scroller before the resize callback', async () => {
    const { pager, pages } = mountCalendar('timeGridDay');
    await vi.advanceTimersByTimeAsync(200);
    const scroller = pages
      .get(pager().activePageId())
      ?.element.querySelector<HTMLElement>(
        '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
      );
    if (!scroller) throw new Error('Active time grid missing');
    scroller.scrollTop = 480;
    scroller.dispatchEvent(new Event('scroll'));
    scroller.scrollTop = 0;
    pager().updateSize();
    expect(scroller.scrollTop).toBe(480);
  });

  it.each(['clientWidth', 'clientHeight'] as const)(
    'ignores a resize-clamped scroll event after %s changes',
    async (dimension) => {
      const { pager, pages } = mountCalendar('timeGridDay');
      await vi.advanceTimersByTimeAsync(200);
      const scroller = pages
        .get(pager().activePageId())
        ?.element.querySelector<HTMLElement>(
          '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
        );
      if (!scroller) throw new Error('Active time grid missing');
      scroller.scrollTop = 480;
      scroller.dispatchEvent(new Event('scroll'));
      Object.defineProperty(scroller, dimension, {
        value: 400,
        configurable: true,
      });
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event('scroll'));
      pager().updateSize();
      expect(scroller.scrollTop).toBe(480);
      scroller.scrollTop = 240;
      scroller.dispatchEvent(new Event('scroll'));
      pager().updateSize();
      expect(scroller.scrollTop).toBe(240);
    }
  );
  it('keeps the visible three-day page until adjacent date selection settles', async () => {
    const { pager, calendar, viewport, pages } =
      mountCalendar('timeGridThreeDay');
    const visible = calendar();
    pager().navigateToDate(new Date(2026, 10, 5));
    expect(pager().pager.position()).toBe(0);
    expect(calendar()).toBe(visible);
    expect(calendar().getDate().getDate()).toBe(1);
    expect(pager().navigationDate().getDate()).toBe(5);
    expect(pages.get(3)?.calendar.getDate().getDate()).toBe(5);
    viewport.scrollLeft = 300;
    viewport.dispatchEvent(new Event('scrollend'));
    await vi.advanceTimersByTimeAsync(200);
    expect(pager().pager.position()).toBe(1);
    expect(calendar().getDate().getDate()).toBe(5);
    expect(pager().activeDate().getDate()).toBe(5);
  });
  it('supersedes an adjacent date anchor when Next is pressed before settlement', async () => {
    const { pager, viewport, calendar } = mountCalendar('timeGridThreeDay');
    pager().navigateToDate(new Date(2026, 10, 5));
    pager().nextPeriod();
    viewport.dispatchEvent(new Event('scrollend'));
    await vi.advanceTimersByTimeAsync(300);
    expect(calendar().getDate().getDate()).toBe(8);
    viewport.scrollLeft = 100;
    viewport.dispatchEvent(new Event('scrollend'));
    await vi.advanceTimersByTimeAsync(200);
    expect(calendar().getDate().getDate()).toBe(5);
  });

  it('keeps a date queued during a small fling that settles at center', async () => {
    const { pager, calendar, viewport } = mountCalendar();
    viewport.scrollLeft = 225;
    viewport.dispatchEvent(new Event('scroll'));
    pager().navigateToDate(new Date(2026, 10, 20));
    expect(calendar().getDate().getDate()).toBe(1);
    viewport.scrollLeft = 200;
    viewport.dispatchEvent(new Event('scrollend'));
    await vi.advanceTimersByTimeAsync(200);
    expect(pager().activeDate().getDate()).toBe(20);
    expect(calendar().getDate().getDate()).toBe(20);
  });

  it('takes Next after a far date jump queued during a fling', async () => {
    const { pager, calendar, viewport } = mountCalendar();
    viewport.scrollLeft = 225;
    viewport.dispatchEvent(new Event('scroll'));
    pager().navigateToDate(new Date(2026, 10, 20));
    pager().nextPeriod();
    viewport.scrollLeft = 300;

    viewport.dispatchEvent(new Event('scrollend'));
    await vi.advanceTimersByTimeAsync(200);
    expect(pager().navigationDate().getDate()).toBe(21);
    expect(pager().activeDate().getDate()).toBe(21);
    expect(calendar().getDate().getDate()).toBe(21);
  });

  it('cancels a pending date slide when paging locks and unlocks at center', async () => {
    const { pager, calendar, viewport } = mountCalendar();
    pager().navigateToDate(new Date(2026, 10, 2));
    pager().setPagingLocked(true);
    viewport.scrollLeft = 200;
    pager().setPagingLocked(false);
    expect(pager().activeDate().getDate()).toBe(1);
    expect(pager().navigationDate().getDate()).toBe(1);
    pager().nextPeriod();
    viewport.scrollLeft = 300;
    viewport.dispatchEvent(new Event('scrollend'));
    await vi.advanceTimersByTimeAsync(200);
    expect(pager().activeDate().getDate()).toBe(2);
    expect(calendar().getDate().getDate()).toBe(2);
  });

  it('keeps an adjacent three-day date queued while scrolling', async () => {
    const { pager, calendar, viewport } = mountCalendar('timeGridThreeDay');
    const visible = calendar();
    viewport.scrollLeft = 225;
    viewport.dispatchEvent(new Event('scroll'));
    pager().navigateToDate(new Date(2026, 10, 5));
    expect(calendar()).toBe(visible);
    expect(calendar().getDate().getDate()).toBe(1);
    viewport.scrollLeft = 300;
    viewport.dispatchEvent(new Event('scrollend'));
    await vi.advanceTimersByTimeAsync(200);
    expect(pager().activeDate().getDate()).toBe(5);
    expect(calendar().getDate().getDate()).toBe(5);
  });
  it.each([
    'timeGridDay',
    'timeGridThreeDay',
    'timeGridWeek',
    'dayGridMonth',
  ] as const)(
    'prepares only the final range after rapid period commands in %s',
    async (view) => {
      const { pager, pages, viewport } = mountCalendar(view);
      await vi.advanceTimersByTimeAsync(300);
      const dateChanges = [...pages.values()].map(({ calendar }) =>
        vi.spyOn(calendar, 'gotoDate')
      );
      for (let index = 0; index < 5; index++) {
        pager().nextPeriod();
        await vi.advanceTimersByTimeAsync(20);
      }
      const target = new Date(2026, 10, 1);
      if (view === 'dayGridMonth') target.setMonth(target.getMonth() + 5);
      else
        target.setDate(
          target.getDate() +
            5 *
              (view === 'timeGridDay' ? 1 : view === 'timeGridThreeDay' ? 3 : 7)
        );
      expect(pager().navigationDate().toDateString()).toBe(
        target.toDateString()
      );
      expect(
        dateChanges.every((change) => change.mock.calls.length === 0)
      ).toBe(true);
      viewport.dispatchEvent(new Event('scrollend'));
      await vi.advanceTimersByTimeAsync(300);
      expect(pager().activeDate().toDateString()).toBe(target.toDateString());
      expect(dateChanges.every((change) => change.mock.calls.length <= 1)).toBe(
        true
      );
    }
  );
  it.each(['timeGridDay', 'timeGridThreeDay'] as const)(
    'lets explicit adjacent date selection supersede a pending period command in %s',
    async (view) => {
      const { pager, calendar, viewport } = mountCalendar(view);
      pager().nextPeriod();
      const target = new Date(2026, 10, view === 'timeGridDay' ? 2 : 5);
      pager().navigateToDate(target);
      viewport.dispatchEvent(new Event('scrollend'));
      await vi.advanceTimersByTimeAsync(300);
      expect(pager().navigationDate().toDateString()).toBe(
        target.toDateString()
      );
      expect(pager().activeDate().toDateString()).toBe(target.toDateString());
      expect(calendar().getDate().toDateString()).toBe(target.toDateString());
    }
  );
  it('anchors an explicit date against an outstanding controller target', async () => {
    const { pager, calendar, viewport } = mountCalendar();
    pager().pager.next();
    pager().navigateToDate(new Date(2026, 10, 2));
    viewport.dispatchEvent(new Event('scrollend'));
    await vi.advanceTimersByTimeAsync(300);
    expect(pager().activeDate().getDate()).toBe(2);
    expect(calendar().getDate().getDate()).toBe(2);
  });
  it('restores the history date and hour position into every mounted grid', async () => {
    const target = new Date(2026, 10, 20);
    const { pager, pages, calendar } = mountCalendar('timeGridDay', {
      date: target,
      scrollTop: 540,
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(pager().navigationDate().toDateString()).toBe(target.toDateString());
    expect(calendar().getDate().toDateString()).toBe(target.toDateString());
    for (const { element } of pages.values()) {
      expect(
        element.querySelector(
          '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
        )?.scrollTop
      ).toBe(540);
    }
  });
  it('retains a restored hour offset until the active grid has layout', async () => {
    const { pager, revealGrids } = mountCalendar('timeGridDay', {
      date: new Date(2026, 10, 20),
      scrollTop: 540,
      laidOut: false,
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(pager().scrollTop()).toBe(540);
    revealGrids();
    const root = pager().activePage()?.element();
    const api = pager().activePage()?.api();
    expect(
      applyTimeGridOpeningScroll(
        root,
        api,
        TIME_GRID_OPENING_SCROLL_TIME,
        pager().scrollTop()
      )
    ).toBe(true);
    expect(
      root?.querySelector('.fc-scroller-harness-liquid > .fc-scroller')
        ?.scrollTop
    ).toBe(540);
  });
  it('keeps the date anchor when desktop wheel interrupts an adjacent date animation', async () => {
    device.touch = false;
    const { pager, viewport } = mountCalendar();
    pager().navigateToDate(new Date(2026, 10, 2));
    viewport.dispatchEvent(
      new WheelEvent('wheel', { deltaX: 40, cancelable: true })
    );
    expect(pager().navigationDate().getDate()).toBe(3);
    await vi.advanceTimersByTimeAsync(400);
    expect(pager().activeDate().getDate()).toBe(3);
  });
});
