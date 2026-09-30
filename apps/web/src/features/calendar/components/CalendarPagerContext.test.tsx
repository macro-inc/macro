import { FullCalendar, useFullCalendar } from '@app/lib/fullcalendar-solid';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import { render } from '@solidjs/testing-library';
import { Pager } from '@ui/components/Pager';
import { createSignal, For, onCleanup, onMount } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarOccurrenceData } from '../hooks/use-calendar-occurrence-data';
import type { CalendarPeriodView } from '../types';
import {
  CALENDAR_PAGE_IDS,
  type CalendarPageId,
  CalendarPagerContextProvider,
  useCalendarPager,
} from './CalendarPagerContext';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1)
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountPager(initialView: CalendarPeriodView = 'timeGridWeek') {
  const [view, setView] = createSignal<CalendarPeriodView>(initialView);
  let pager!: ReturnType<typeof useCalendarPager>;
  const calendars = new Map<
    CalendarPageId,
    ReturnType<typeof useFullCalendar>
  >();
  const data: CalendarOccurrenceData = {
    range: () => undefined,
    occurrencesQuery: {} as CalendarOccurrenceData['occurrencesQuery'],
    events: () => [],
    visibleEvents: () => [],
    eventsById: () => new Map(),
    isLoading: () => false,
    isSyncing: () => false,
  };
  function Register(props: { id: CalendarPageId }) {
    const calendar = useFullCalendar();
    calendars.set(props.id, calendar);
    onMount(() => {
      onCleanup(
        pager.registerPage({
          id: props.id,
          api: calendar.api,
          dateInfo: calendar.dateInfo,
          element: () => undefined,
          data,
        })
      );
    });
    return <FullCalendar.Host />;
  }
  function Pages() {
    pager = useCalendarPager();
    return (
      <Pager.Root controller={pager.pager}>
        <Pager.Viewport>
          <For each={CALENDAR_PAGE_IDS}>
            {(id) => (
              <Pager.Page id={id}>
                <FullCalendar.Root
                  plugins={[dayGridPlugin, timeGridPlugin]}
                  initialView={initialView}
                  initialDate={pager.initialDateFor(id)}
                  headerToolbar={false}
                  handleWindowResize={false}
                >
                  <Register id={id} />
                </FullCalendar.Root>
              </Pager.Page>
            )}
          </For>
        </Pager.Viewport>
      </Pager.Root>
    );
  }
  const mounted = render(() => (
    <CalendarPagerContextProvider
      initialView={view()}
      showWeekends={() => true}
      weekStartsOn={() => 0}
      onNavigate={() => {}}
      onViewChange={setView}
    >
      <Pages />
    </CalendarPagerContextProvider>
  ));
  const types = () =>
    [...mounted.container.querySelectorAll('.fc-view')].map((element) =>
      [...element.classList].find((className) => className.endsWith('-view'))
    );
  const viewport = mounted.container.querySelector<HTMLDivElement>('.pager')!;
  Object.defineProperty(viewport, 'clientWidth', {
    value: 900,
    configurable: true,
  });
  return { pager, calendars, types, unmount: mounted.unmount };
}

function expectBuffersAligned({
  pager,
  calendars,
}: ReturnType<typeof mountPager>) {
  const current = pager.activePage()!.api()!;
  for (const [index, id] of pager.pageOrder().entries()) {
    const api = calendars.get(id)!.api()!;
    const expected = new Date(current.view.currentStart);
    const offset = index - 1;
    if (pager.periodView() === 'dayGridMonth') {
      expected.setMonth(expected.getMonth() + offset);
    } else {
      expected.setDate(
        expected.getDate() +
          offset * (pager.periodView() === 'timeGridWeek' ? 7 : 1)
      );
    }
    expect(api.view.type).toBe(pager.periodView());
    expect(api.view.currentStart.getTime()).toBe(expected.getTime());
  }
}

describe('calendar period rendering', () => {
  it('updates selection immediately and yields between all three grid redraws', async () => {
    const { pager, types } = mountPager();
    pager.changeView('dayGridMonth');
    expect(pager.periodView()).toBe('dayGridMonth');
    expect(types()).toEqual(Array(3).fill('fc-timeGridWeek-view'));
    expect(pager.isChangingView()).toBe(true);
    await vi.advanceTimersByTimeAsync(16);
    expect(types()).toEqual([
      'fc-timeGridWeek-view',
      'fc-dayGridMonth-view',
      'fc-timeGridWeek-view',
    ]);
    expect(pager.isChangingView()).toBe(false);
    await vi.advanceTimersByTimeAsync(16);
    expect(types()).toEqual([
      'fc-dayGridMonth-view',
      'fc-dayGridMonth-view',
      'fc-timeGridWeek-view',
    ]);
    await vi.advanceTimersByTimeAsync(16);
    expect(types()).toEqual(Array(3).fill('fc-dayGridMonth-view'));
  });

  it('renders only the last requested period and cancels a reverted change', async () => {
    const { pager, types } = mountPager();
    pager.changeView('dayGridMonth');
    pager.changeView('timeGridDay');
    await vi.advanceTimersByTimeAsync(48);
    expect(types()).toEqual(Array(3).fill('fc-timeGridDay-view'));
    pager.changeView('dayGridMonth');
    pager.changeView('timeGridDay');
    await vi.advanceTimersByTimeAsync(48);
    expect(types()).toEqual(Array(3).fill('fc-timeGridDay-view'));
  });

  it('preserves date navigation while a period redraw is pending', async () => {
    const { pager, types } = mountPager();
    const target = new Date(2026, 10, 16);
    pager.changeView('timeGridDay');
    pager.navigateToDate(target);
    await vi.advanceTimersByTimeAsync(48);
    expect(types()).toEqual(Array(3).fill('fc-timeGridDay-view'));
    expect(pager.activePage()!.api()!.getDate().getTime()).toBe(
      target.getTime()
    );
  });

  it('preserves date navigation while hidden buffers catch up', async () => {
    const { pager } = mountPager();
    const target = new Date(2026, 10, 16);
    pager.changeView('timeGridDay');
    await vi.advanceTimersByTimeAsync(16);
    pager.navigateToDate(target);
    await vi.advanceTimersByTimeAsync(48);
    expect(pager.activePage()!.api()!.getDate().getTime()).toBe(
      target.getTime()
    );
  });
  it('cancels a queued date navigation when a newer date starts a page transition', async () => {
    const { pager } = mountPager();
    const first = new Date(pager.activePage()!.api()!.getDate());
    first.setDate(first.getDate() + 1);
    const latest = new Date(first);
    latest.setDate(latest.getDate() + 14);
    pager.gotoDate(first);
    pager.navigateToDate(latest);
    await vi.advanceTimersByTimeAsync(64);
    expect(pager.activePage()!.api()!.getDate().getTime()).toBe(
      latest.getTime()
    );
  });

  it('cancels queued redraws when the calendar unmounts', async () => {
    const { pager, unmount } = mountPager();
    const changeView = vi.spyOn(pager.activePage()!.api()!, 'changeView');
    pager.changeView('dayGridMonth');
    unmount();
    await vi.advanceTimersByTimeAsync(48);
    expect(changeView).not.toHaveBeenCalled();
  });
});
describe('calendar arrow navigation', () => {
  it('keeps a single-step slide but interrupts it for rapid cumulative clicks', async () => {
    const mounted = mountPager();
    const { pager } = mounted;
    const target = new Date(pager.activePage()!.api()!.getDate());
    target.setDate(target.getDate() + 21);
    pager.nextPeriod();
    expect(pager.pager.phase()).toBe('settling');
    pager.nextPeriod();
    pager.nextPeriod();
    expect(pager.pager.phase()).toBe('idle');
    expect(pager.navigationDate()!.getTime()).toBe(target.getTime());
    await vi.advanceTimersByTimeAsync(48);
    expect(pager.activePage()!.api()!.getDate().getTime()).toBe(
      target.getTime()
    );
    expectBuffersAligned(mounted);
  });

  it('counts direction changes during an unfinished transition', async () => {
    const mounted = mountPager();
    const { pager } = mounted;
    const target = new Date(pager.activePage()!.api()!.getDate());
    target.setDate(target.getDate() + 7);
    pager.nextPeriod();
    pager.nextPeriod();
    pager.previousPeriod();
    await vi.advanceTimersByTimeAsync(48);
    expect(pager.activePage()!.api()!.getDate().getTime()).toBe(
      target.getTime()
    );
    expectBuffersAligned(mounted);
  });

  it('accepts arrows while hidden buffers are still changing view', async () => {
    const mounted = mountPager();
    const { pager } = mounted;
    pager.changeView('timeGridDay');
    await vi.advanceTimersByTimeAsync(16);
    const target = new Date(pager.activePage()!.api()!.getDate());
    target.setDate(target.getDate() + 2);
    pager.nextPeriod();
    pager.nextPeriod();
    await vi.advanceTimersByTimeAsync(48);
    expect(pager.activePage()!.api()!.getDate().getTime()).toBe(
      target.getTime()
    );
    expectBuffersAligned(mounted);
  });

  it('steps from a queued explicit date rather than the old grid date', async () => {
    const { pager } = mountPager();
    const date = new Date(2026, 10, 16);
    const target = new Date(2026, 10, 23);
    pager.gotoDate(date);
    pager.nextPeriod();
    await vi.advanceTimersByTimeAsync(48);
    expect(pager.activePage()!.api()!.getDate().getTime()).toBe(
      target.getTime()
    );
  });

  it('steps from the destination of an unfinished explicit-date transition', async () => {
    const { pager } = mountPager();
    pager.navigateToDate(new Date(2026, 10, 16));
    expect(pager.pager.phase()).toBe('settling');
    pager.nextPeriod();
    await vi.advanceTimersByTimeAsync(48);
    expect(pager.activePage()!.api()!.getDate().getTime()).toBe(
      new Date(2026, 10, 23).getTime()
    );
  });

  it('lets an explicit date supersede pending arrow clicks', async () => {
    const { pager } = mountPager();
    const target = new Date(2026, 10, 16);
    pager.nextPeriod();
    pager.nextPeriod();
    pager.navigateToDate(target);
    await vi.advanceTimersByTimeAsync(64);
    expect(pager.activePage()!.api()!.getDate().getTime()).toBe(
      target.getTime()
    );
  });

  it('preserves the latest requested date when the period changes', async () => {
    const { pager, types } = mountPager();
    const target = new Date(pager.activePage()!.api()!.getDate());
    target.setDate(target.getDate() + 14);
    pager.nextPeriod();
    pager.nextPeriod();
    pager.changeView('timeGridDay');
    await vi.advanceTimersByTimeAsync(48);
    target.setHours(0, 0, 0, 0);
    expect(types()).toEqual(Array(3).fill('fc-timeGridDay-view'));
    expect(pager.activePage()!.api()!.getDate().getTime()).toBe(
      target.getTime()
    );
  });

  it('preserves an explicit-date slide target when the period changes', async () => {
    const mounted = mountPager();
    const { pager, types } = mounted;
    const target = new Date(2026, 10, 16);
    pager.navigateToDate(target);
    expect(pager.pager.phase()).toBe('settling');
    pager.changeView('timeGridDay');
    await vi.advanceTimersByTimeAsync(64);
    expect(types()).toEqual(Array(3).fill('fc-timeGridDay-view'));
    expect(pager.activePage()!.api()!.getDate().getTime()).toBe(
      target.getTime()
    );
    expectBuffersAligned(mounted);
  });

  it('synchronizes both buffers after an explicit-date slide commits', async () => {
    const mounted = mountPager();
    const { pager } = mounted;
    const target = new Date(2027, 1, 23);
    pager.navigateToDate(target);
    expect(pager.navigationDate()!.getTime()).toBe(target.getTime());
    await vi.advanceTimersByTimeAsync(238);
    expect(pager.activePage()!.api()!.getDate().getTime()).toBe(
      target.getTime()
    );
    expectBuffersAligned(mounted);
  });

  it('does not retry an explicit-date slide after unmount', async () => {
    const { pager, unmount } = mountPager();
    const gotoDate = vi.spyOn(pager.activePage()!.api()!, 'gotoDate');
    pager.navigateToDate(new Date(2026, 10, 16));
    expect(pager.pager.phase()).toBe('settling');
    unmount();
    await vi.advanceTimersByTimeAsync(64);
    expect(gotoDate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['timeGridDay', new Date(2026, 1, 2)],
    ['dayGridMonth', new Date(2026, 2, 1)],
  ] as const)(
    'counts rapid %s arrows across month boundaries',
    async (view, target) => {
      const mounted = mountPager(view);
      const { pager } = mounted;
      pager.gotoDate(new Date(2026, 0, 31));
      await vi.advanceTimersByTimeAsync(48);
      pager.nextPeriod();
      pager.nextPeriod();
      await vi.advanceTimersByTimeAsync(48);
      expect(pager.activePage()!.api()!.getDate().getTime()).toBe(
        target.getTime()
      );
      expectBuffersAligned(mounted);
    }
  );

  it('preserves gesture paging after rapid arrow navigation', async () => {
    const mounted = mountPager();
    const { pager } = mounted;
    const target = new Date(pager.activePage()!.api()!.view.currentStart);
    target.setDate(target.getDate() + 7);
    pager.nextPeriod();
    pager.nextPeriod();
    await vi.advanceTimersByTimeAsync(48);
    expect(pager.pager.beginDrag()).toBe(true);
    pager.pager.updateDrag(600);
    const transition = pager.pager.commitDrag('previous');
    await vi.advanceTimersByTimeAsync(190);
    expect(await transition).toBe(true);
    await vi.advanceTimersByTimeAsync(48);
    expect(pager.activePage()!.api()!.view.currentStart.getTime()).toBe(
      target.getTime()
    );
    expectBuffersAligned(mounted);
  });

  it('does not retry an interrupted arrow after unmount', async () => {
    const { pager, unmount } = mountPager();
    const api = pager.activePage()!.api()!;
    const gotoDate = vi.spyOn(api, 'gotoDate');
    pager.nextPeriod();
    expect(pager.pager.phase()).toBe('settling');
    unmount();
    await vi.advanceTimersByTimeAsync(64);
    expect(gotoDate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
