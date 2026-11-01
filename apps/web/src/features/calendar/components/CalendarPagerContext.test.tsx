import { Calendar, type DatesSetArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarPeriodView } from '../types';
import {
  CalendarPagerContextProvider,
  useCalendarPager,
} from './CalendarPagerContext';

function mountCalendar(view: CalendarPeriodView = 'timeGridDay') {
  const element = document.createElement('div');
  let calendar: Calendar;
  const scrollToTime = vi.fn();

  function Controls() {
    const pager = useCalendarPager();
    const [dateInfo, setDateInfo] = createSignal<DatesSetArg>();
    onMount(() => {
      calendar = new Calendar(element, {
        plugins: [timeGridPlugin, dayGridPlugin],
        initialView: view,
        initialDate: new Date(2026, 10, 1),
        datesSet: setDateInfo,
      });
      calendar.render();
      vi.spyOn(calendar, 'scrollToTime').mockImplementation(scrollToTime);
      const unregister = pager.registerPage({
        id: 'current',
        api: () => calendar,
        dateInfo,
        element: () => element,
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
        calendar.destroy();
      });
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
  return { calendar: () => calendar, scrollToTime };
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

describe('calendar Today navigation', () => {
  it.each(['timeGridDay', 'timeGridWeek'] as const)(
    'scrolls to the current time even when already on today in %s',
    async (view) => {
      const { calendar, scrollToTime } = mountCalendar(view);
      fireEvent.click(screen.getByRole('button', { name: 'Today' }));
      expect(scrollToTime).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(calendar().getDate().getDate()).toBe(1);
      expect(scrollToTime).toHaveBeenCalledWith({ minutes: 765 });
    }
  );

  it('returns from another date before scrolling to the current time', async () => {
    const { calendar, scrollToTime } = mountCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Another date' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(calendar().getDate().getDate()).toBe(5);
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(calendar().getDate().getDate()).toBe(1);
    expect(scrollToTime).toHaveBeenCalledWith({ minutes: 765 });
  });

  it('clamps the context above the current time to midnight', async () => {
    vi.setSystemTime(new Date(2026, 10, 1, 0, 15));
    const { scrollToTime } = mountCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(scrollToTime).toHaveBeenCalledWith({ minutes: 0 });
  });

  it('cancels a pending Today scroll when another date is selected', async () => {
    const { calendar, scrollToTime } = mountCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    fireEvent.click(screen.getByRole('button', { name: 'Another date' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(calendar().getDate().getDate()).toBe(5);
    expect(scrollToTime).not.toHaveBeenCalled();
  });

  it('cancels a pending Today scroll when paging forward', async () => {
    const { calendar, scrollToTime } = mountCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(calendar().getDate().getDate()).toBe(2);
    expect(scrollToTime).not.toHaveBeenCalled();
  });
});
