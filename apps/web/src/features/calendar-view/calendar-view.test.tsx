/**
 * @vitest-environment jsdom
 */

import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import { cleanup, render } from '@solidjs/testing-library';
import { createSnapPager } from '@ui/components/SnapPager/SnapPager';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarPageRange } from '../calendar/core/page-range';
import { createCalendarPageMounts } from '../calendar/primitives/create-calendar-page-mounts';
import { createMobileGridAxis } from './primitives/create-mobile-grid-axis';
import { MobileCalendarGridAxis } from './views/mobile/calendar-grid-axis';

const mocks = vi.hoisted(() => ({
  markRead: vi.fn(async () => {}),
  setSearch: vi.fn(),
  notificationSource: { id: 'notification-source' },
  focusEvent: (_eventId: string | undefined) => {},
  isInlinePreview: false,
  contentParams: undefined as Record<string, unknown> | undefined,
  searchEventId: '',
}));

vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  CalendarViewContextProvider: (props: {
    onFocusedEventIdChange: (eventId: string | undefined) => void;
    children: JSX.Element;
  }) => {
    mocks.focusEvent = props.onFocusedEventIdChange;
    return props.children;
  },
}));
vi.mock('@app/features/calendar/utils/calendar-supported-range', () => ({
  isCalendarRangeSupported: () => true,
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ pageView: vi.fn(), track: vi.fn() }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  usePosthog: () => ({ flagsLoaded: () => true }),
}));
vi.mock('@app/lib/split-router', () => ({
  createSearchParams: () => [
    {
      eventId: mocks.searchEventId,
      occurrenceKey: '',
      startDate: '',
      endDate: '',
    },
    mocks.setSearch,
  ],
  createSearchParamsCodec: () => ({ serialize: () => ({}) }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ period: 'timeGridWeek' }),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => mocks.notificationSource,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    isInlinePreview: mocks.isInlinePreview,
    handle: {
      content: () => ({
        type: 'component',
        id: 'calendar',
        params: mocks.contentParams,
      }),
    },
  }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@notifications/notification-helpers', () => ({
  markNotificationsForEntityAsRead: mocks.markRead,
}));
vi.mock('@queries/calendar/occurrences', () => ({
  useCalendarOccurrencesQuery: () => ({}),
}));
vi.mock('./calendar-focus-target', () => ({
  CalendarFocusContextProvider: (props: { children: JSX.Element }) =>
    props.children,
}));
vi.mock('./calendar-target', () => ({
  createCalendarFocusTarget: () => () => undefined,
}));
vi.mock('./calendar-target-request', () => ({
  createCalendarTargetAim: () => ({
    target: () => undefined,
    aimAt: vi.fn(),
  }),
}));
vi.mock('./calendar-view-skeleton', () => ({
  CalendarViewSkeleton: () => null,
}));
vi.mock('./components/Workspace', () => ({ Workspace: () => null }));

import { CalendarView } from './calendar-view';

function openCalendar() {
  render(() => <CalendarView route={{ id: 'view-calendar' }} />);
}

beforeEach(() => {
  mocks.markRead.mockClear();
  mocks.setSearch.mockClear();
  mocks.isInlinePreview = false;
  mocks.contentParams = undefined;
  mocks.searchEventId = '';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('marking an event read when Calendar lands on it', () => {
  it('marks the event a link opened, keeping the link in the URL', () => {
    mocks.searchEventId = 'event';
    openCalendar();

    mocks.focusEvent('event');

    expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(
      mocks.notificationSource,
      { type: 'calendar_event', id: 'event' }
    );
    expect(mocks.setSearch).not.toHaveBeenCalled();
  });

  it('leaves the read to the row that opened the event', () => {
    mocks.searchEventId = 'event';
    mocks.contentParams = { eventId: 'event', focusRequestId: 1 };
    openCalendar();

    mocks.focusEvent('event');

    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it("leaves the read to Home's row in its inline calendar", () => {
    mocks.searchEventId = 'event';
    mocks.isInlinePreview = true;
    openCalendar();

    mocks.focusEvent('event');

    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('marks the copy a link resolved to and names it in the URL', () => {
    mocks.searchEventId = 'another-copy';
    openCalendar();

    mocks.focusEvent('own-copy');

    expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(
      mocks.notificationSource,
      { type: 'calendar_event', id: 'own-copy' }
    );
    expect(mocks.setSearch).toHaveBeenCalledWith(
      { eventId: 'own-copy' },
      { mode: 'replace', history: 'replace' }
    );
  });

  it('marks each event selected after the landing', () => {
    mocks.searchEventId = 'event';
    mocks.contentParams = { eventId: 'event', focusRequestId: 1 };
    openCalendar();
    mocks.focusEvent('event');

    mocks.focusEvent('next-event');

    expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(
      mocks.notificationSource,
      { type: 'calendar_event', id: 'next-event' }
    );
  });
});

describe('stationary phone time axis', () => {
  it('retains measured hour labels while the pager changes its active grid', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const viewport = document.createElement('div');
    const root = document.createElement('div');
    root.className = 'snap-pager-page';
    root.innerHTML =
      '<div class="fc-timegrid"><div class="fc-scroller-harness-liquid"><div class="fc-scroller"><div class="fc-timegrid-slot-label-cushion">9am</div><div class="fc-timegrid-now-indicator-line"><span class="calendar-now-time">9:30</span></div></div></div></div>';
    const scroller = root.querySelector<HTMLElement>('.fc-scroller')!;
    const label = root.querySelector<HTMLElement>(
      '.fc-timegrid-slot-label-cushion'
    )!;
    Object.defineProperty(scroller, 'clientHeight', { value: 200 });
    scroller.getBoundingClientRect = () => new DOMRect(0, 80, 300, 200);
    viewport.getBoundingClientRect = () => new DOMRect(0, 0, 350, 400);
    label.getBoundingClientRect = () => new DOMRect(0, 120, 46, 14);
    const now = root.querySelector<HTMLElement>(
      '.fc-timegrid-now-indicator-line'
    )!;
    now.getBoundingClientRect = () => new DOMRect(46, 140, 300, 1);
    Object.defineProperty(now, 'getClientRects', {
      value: () => [now.getBoundingClientRect()],
    });
    const [paused, setPaused] = createSignal(false);
    let axis!: ReturnType<typeof createMobileGridAxis>;
    const mountedAxis = render(() => {
      axis = createMobileGridAxis(
        () => root,
        () => viewport,
        paused
      );
      return (
        <MobileCalendarGridAxis
          root={() => root}
          viewport={() => viewport}
          paused={paused}
        />
      );
    });
    await vi.advanceTimersByTimeAsync(20);
    const labels = axis.state.labels;
    expect(labels[0].text).toBe('9am');
    const line = mountedAxis.container.querySelector(
      '[data-calendar-current-time-line]'
    );
    expect(line).not.toBeNull();
    expect(line?.closest('.snap-pager-page')).toBeNull();
    setPaused(true);
    label.textContent = '10am';
    scroller.scrollTop = 300;
    scroller.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(40);
    expect(axis.state.labels).toBe(labels);
    expect(axis.state.labels[0].text).toBe('9am');
    expect(axis.state.scrollTop).toBe(300);
    setPaused(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(axis.state.labels[0].text).toBe('10am');
    expect(axis.state.scrollTop).toBe(300);
  });
});

describe('bounded calendar preload window', () => {
  it('keeps the phone month prefetch on its complete Sunday-first grid', () => {
    const range = calendarPageRange(new Date(2026, 1, 1), 'dayGridMonth', {
      showWeekends: false,
      weekStartsOn: 1,
      phone: true,
    });
    expect(range.start).toEqual(new Date(2026, 1, 1));
    expect(range.end).toEqual(new Date(2026, 2, 8));
  });
  it('mounts both neighbor pages without waiting for events and pauses during gestures', async () => {
    vi.useFakeTimers();
    const pager = createSnapPager();
    const viewport = document.createElement('div');
    Object.defineProperty(viewport, 'clientWidth', { value: 100 });
    const detach = pager.attachViewport(viewport);
    let mounted!: ReturnType<typeof createCalendarPageMounts>;
    render(() => {
      mounted = createCalendarPageMounts(pager);
      return null;
    });
    expect(mounted()).toEqual([2]);
    viewport.dispatchEvent(new Event('touchstart'));
    await vi.advanceTimersByTimeAsync(120);
    expect(mounted()).toEqual([2]);
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    await vi.advanceTimersByTimeAsync(400);
    expect([...mounted()].sort()).toEqual([0, 1, 2, 3, 4]);
    detach();
  });

  it.each([
    ['timeGridDay', new Date(2026, 2, 7), false, 0],
    ['timeGridThreeDay', new Date(2026, 2, 6), false, 0],
    ['timeGridThreeDay', new Date(2026, 2, 7), false, 0],
    ['timeGridThreeDay', new Date(2026, 2, 7), true, 1],
    ['timeGridWeek', new Date(2026, 2, 8), false, 0],
    ['dayGridMonth', new Date(2024, 1, 1), false, 1],
    ['dayGridMonth', new Date(2026, 8, 1), true, 0],
  ] as const)(
    'preloads the exact %s range before the grid renders',
    (view, date, showWeekends, weekStartsOn) => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          disconnect() {}
        }
      );
      const element = document.createElement('div');
      const grid = new Calendar(element, {
        plugins: [dayGridPlugin, timeGridPlugin],
        initialView: view,
        initialDate: date,
        weekends: showWeekends,
        firstDay: weekStartsOn,
        fixedWeekCount: false,
        views: {
          timeGridThreeDay: {
            type: 'timeGrid',
            duration: { days: 3 },
            dateIncrement: { days: 3 },
            dateAlignment: 'day',
          },
        },
      });
      try {
        grid.render();
        const planned = calendarPageRange(date, view, {
          showWeekends,
          weekStartsOn,
          phone: false,
        });
        expect(planned.start.getTime()).toBe(grid.view.activeStart.getTime());
        expect(planned.end.getTime()).toBe(grid.view.activeEnd.getTime());
      } finally {
        grid.destroy();
      }
    }
  );
});

describe('hidden viewport unlock recovery', () => {
  it.each(['hidden', 'held', 'queued', 'queued-multi', 'mid-slide', 'reduced'])(
    'resumes the committed page without losing navigation (%s)',
    async (mode) => {
      vi.useFakeTimers();
      vi.stubGlobal('matchMedia', () => ({ matches: mode === 'reduced' }));
      let width = 100;
      const viewport = document.createElement('div');
      Object.defineProperty(viewport, 'clientWidth', { get: () => width });
      const pager = createSnapPager();
      const detach = pager.attachViewport(viewport);
      try {
        await vi.advanceTimersByTimeAsync(20);
        viewport.scrollLeft = 270;
        const queued = mode === 'queued' || mode === 'queued-multi';
        const held = mode === 'held' || queued;
        if (held) viewport.dispatchEvent(new Event('touchstart'));
        pager.setLocked(true);
        if (mode !== 'mid-slide') width = 0;
        pager.setLocked(false);
        if (queued) pager.goTo(5);
        if (mode === 'mid-slide') {
          await vi.advanceTimersByTimeAsync(32);
          width = 0;
        }
        viewport.scrollLeft = 0;
        pager.resize();
        if (mode !== 'hidden' && mode !== 'reduced') {
          viewport.dispatchEvent(new Event('scroll'));
          viewport.dispatchEvent(new Event('scrollend'));
        }
        if (mode === 'held')
          window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
        await vi.advanceTimersByTimeAsync(500);
        expect(pager.position()).toBe(0);
        expect(viewport.scrollLeft).toBe(0);
        width = 100;
        if (mode !== 'hidden' && mode !== 'reduced') {
          viewport.dispatchEvent(new Event('scroll'));
          viewport.dispatchEvent(new Event('scrollend'));
        }
        pager.resize();
        if (queued) {
          if (mode === 'queued-multi')
            viewport.dispatchEvent(new Event('touchstart'));
          expect(viewport.scrollLeft).toBe(0);
          window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
        }
        await vi.advanceTimersByTimeAsync(800);
        const position = queued ? 5 : 0;
        expect(pager.position()).toBe(position);
        expect(pager.phase()).toBe('idle');
        expect(viewport.scrollLeft).toBe(200);
        expect(viewport.style.scrollSnapType).toBe('');
        viewport.dispatchEvent(new Event('touchstart'));
        viewport.scrollLeft = 270;
        viewport.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
        viewport.dispatchEvent(new Event('scrollend'));
        await vi.advanceTimersByTimeAsync(200);
        expect(pager.position()).toBe(position + 1);
      } finally {
        detach();
      }
    }
  );
});
