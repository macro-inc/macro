import { Calendar, type DatesSetArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarGridPeriodView } from '../types';
import {
  CalendarPagerContextProvider,
  useCalendarPager,
} from './CalendarPagerContext';

function mountCalendar(view: CalendarGridPeriodView = 'timeGridDay') {
  const element = document.createElement('div');
  let pagerContext: ReturnType<typeof useCalendarPager>;
  const pages = new Map<
    number,
    { calendar: Calendar; element: HTMLDivElement }
  >();
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientWidth', { value: 100 });
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
});
