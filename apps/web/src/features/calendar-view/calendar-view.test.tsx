/**
 * @vitest-environment jsdom
 */

import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createEffect, createSignal, type JSX, onCleanup } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CalendarGrid,
  type CalendarGridHandle,
} from '../calendar/components/CalendarGrid';
import {
  CalendarPageRenderer,
  type CalendarPageRenderHandle,
} from '../calendar/components/CalendarPageRenderer';
import {
  CalendarPagerContextProvider,
  useCalendarPager,
} from '../calendar/components/CalendarPagerContext';
import {
  calendarPageDateInfo,
  calendarPageRange,
} from '../calendar/core/page-range';
import { type CalendarEvent, DEFAULT_CALENDAR_SOURCE } from '../calendar/types';
import { MonthDaySheet } from './components/month/MonthDaySheet';
import { MonthGrid } from './components/month/MonthGrid';
import { layoutPhoneMonthWeek } from './core/phone-month-layout';
import { createMobileGridAxis } from './primitives/create-mobile-grid-axis';
import { CalendarPagePreloads } from './views/CalendarPagePreloads';
import { MobileCalendarGridAxis } from './views/mobile/calendar-grid-axis';

const mocks = vi.hoisted(() => ({
  markRead: vi.fn(async () => {}),
  setSearch: vi.fn(),
  notificationSource: { id: 'notification-source' },
  focusEvent: (
    _eventId: string | undefined,
    _landedOccurrenceKey?: string
  ) => {},
  isInlinePreview: false,
  contentParams: undefined as Record<string, unknown> | undefined,
  searchEventId: '',
  searchOccurrenceKey: '',
  searchStartDate: '',
  requestedRanges: [] as string[],
  liveRanges: new Set<string>(),
}));

vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  CalendarViewContextProvider: (props: {
    onFocusedEventIdChange: (
      eventId: string | undefined,
      landedOccurrenceKey?: string
    ) => void;
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
      occurrenceKey: mocks.searchOccurrenceKey,
      startDate: mocks.searchStartDate,
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
  useCalendarOccurrencesQuery: (
    input: () => { range?: { start: string } },
    options?: () => { enabled?: boolean }
  ) => {
    createEffect(() => {
      const start = input().range?.start;
      if (!start || options?.().enabled === false) return;
      mocks.requestedRanges.push(start);
      mocks.liveRanges.add(start);
      onCleanup(() => mocks.liveRanges.delete(start));
    });
    return {};
  },
  createCalendarOccurrenceQueryRange: (start: Date, end: Date) => ({
    start: start.toISOString(),
    end: end.toISOString(),
  }),
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
  mocks.searchOccurrenceKey = '';
  mocks.searchStartDate = '';
  mocks.requestedRanges = [];
  mocks.liveRanges.clear();
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

it('matches the phone width compensation against the grid hierarchy', () => {
  const dom = document.implementation.createHTMLDocument();
  dom.documentElement.dataset.touchDevice = 'true';
  // Page wraps CalendarGridHost, which supplies the inner .calendar-view.
  dom.body.innerHTML =
    '<div class="calendar-view-content"><div class="phone-time-page"><div class="calendar-view"><div class="fc"></div></div></div></div>';
  const page = dom.querySelector('.phone-time-page');
  if (!page) throw new Error('Phone page missing');
  const style = document.createElement('style');
  style.textContent = readFileSync(
    'src/features/calendar/calendar-phone-grid.css',
    'utf8'
  );
  document.head.append(style);
  try {
    let compensation: CSSStyleRule | undefined;
    for (const media of style.sheet?.cssRules ?? []) {
      if (!(media instanceof CSSMediaRule)) continue;
      for (const rule of media.cssRules) {
        if (
          rule instanceof CSSStyleRule &&
          rule.selectorText.includes('.phone-time-page')
        )
          compensation = rule;
      }
    }
    if (!compensation) throw new Error('Phone width compensation missing');
    expect(page.matches(compensation.selectorText)).toBe(true);
  } finally {
    style.remove();
  }
});

describe('phone Month presentation', () => {
  const event: CalendarEvent = {
    id: 'month-event',
    eventId: 'month-event',
    occurrenceKey: '2026-11-02T09:00:00Z',
    isCancelled: false,
    isReadOnly: false,
    attendees: [],
    guestPolicy: {
      canModify: false,
      canInviteOthers: false,
      canSeeOtherGuests: false,
    },
    viewerCan: {
      editDetails: false,
      inviteGuests: false,
      organize: false,
      removeGuests: false,
      rsvp: false,
      setGuestPolicy: false,
    },
    sourceCalendarIds: [],
    recurrenceLines: [],
    title: 'Planning',
    start: '2026-11-02T09:00:00Z',
    end: '2026-11-02T10:00:00Z',
    allDay: false,
    calendar: { id: 'calendar', name: 'Calendar', color: '#517be6' },
    visibleCalendars: [],
  };

  it('keeps timed titles without time labels in the fixed weekday columns', () => {
    const days = Array.from({ length: 7 }, (_, index) => ({
      date: new Date(2026, 10, 2 + index),
      events: index === 0 ? [event] : [],
    }));
    const { container } = render(() => (
      <MonthGrid
        weeks={[layoutPhoneMonthWeek(days, 3)]}
        month={days[0].date}
        today={days[0].date}
        selected={undefined}
        capacity={3}
        cardRef={() => {}}
        isSupported={() => true}
        onPick={() => {}}
      />
    ));
    expect(container.querySelector('.phone-month-bar')?.textContent).toBe(
      'Planning'
    );
    expect(container.querySelector('.calendar-event-time')).toBeNull();
    const weekdays = container.querySelector<HTMLElement>(
      '.phone-month-weekdays'
    );
    expect(weekdays?.children.length).toBe(7);
    expect(weekdays?.style.gridTemplateColumns).toBe(
      'repeat(7, minmax(0, 1fr))'
    );
    const style = document.createElement('style');
    style.textContent = readFileSync(
      'src/features/calendar-view/components/month/month-grid.css',
      'utf8'
    );
    document.head.append(style);
    try {
      expect(
        Array.from(style.sheet?.cssRules ?? []).find(
          (rule) =>
            rule instanceof CSSStyleRule &&
            rule.selectorText === '.phone-month-weekdays'
        )?.cssText
      ).toContain('font-size: var(--text-xs)');
    } finally {
      style.remove();
    }
  });

  it('keeps the day-sheet title noninteractive while preserving event and create actions', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const select = vi.fn();
    const create = vi.fn();
    render(() => (
      <MonthDaySheet
        open
        date={new Date(2026, 10, 2)}
        events={[
          event,
          {
            ...event,
            id: 'override-event',
            title: 'Override',
            calendar: { ...event.calendar, color: '#b24499' },
          },
          {
            ...event,
            id: 'fallback-event',
            title: 'Fallback',
            calendar: DEFAULT_CALENDAR_SOURCE,
          },
        ]}
        timeFormat="24-hour"
        onOpenChange={() => {}}
        onCreate={create}
        onSelect={select}
        ref={() => {}}
      />
    ));
    const title = await screen.findByRole('heading', {
      name: 'Mon, November 2',
    });
    expect(title.closest('button')).toBeNull();
    expect(screen.getByRole('dialog').classList.contains('bg-menu')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Open day view' })).toBeNull();
    const eventRow = screen.getByRole('button', { name: /Planning/ });
    expect(eventRow.textContent).toContain('09:00');
    expect(eventRow.classList.contains('calendar-agenda-event')).toBe(false);
    expect(eventRow.classList.contains('text-ink')).toBe(true);
    expect(eventRow.querySelector('.text-ink-muted')?.textContent).toContain(
      '09:00 – 10:00'
    );
    const dot = eventRow.querySelector<HTMLElement>(
      '[aria-hidden="true"] span'
    );
    expect(dot?.classList.contains('border')).toBe(false);
    expect(dot?.style.backgroundColor).toBe('rgb(81, 123, 230)');
    const overrideDot = screen
      .getByRole('button', { name: /Override/ })
      .querySelector<HTMLElement>('[aria-hidden="true"] span');
    expect(overrideDot?.style.backgroundColor).toBe('rgb(178, 68, 153)');
    const fallbackDot = screen
      .getByRole('button', { name: /Fallback/ })
      .querySelector<HTMLElement>('[aria-hidden="true"] span');
    expect(fallbackDot?.getAttribute('style')).toContain(
      'background-color: var(--color-accent)'
    );
    fireEvent.click(eventRow);
    expect(select).toHaveBeenCalledWith(event, eventRow);
    fireEvent.click(
      screen.getByRole('button', { name: 'Create event on selected day' })
    );
    expect(create).toHaveBeenCalledOnce();
  });
});

describe('phone time-grid spacing', () => {
  it('retains the two-lane Week cap and sends a third all-day event to overflow', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    let handle: CalendarGridHandle | undefined;
    const { container } = render(() => (
      <CalendarGrid
        initialDate={new Date(2026, 10, 2)}
        events={[]}
        eventsById={new Map()}
        settings={{
          initialView: 'timeGridWeek',
          compactAllDaySlot: true,
          showWeekends: true,
          weekStartsOn: 1,
          timeFormat: '24-hour',
          useNarrowDayHeaders: false,
          useNarrowEventContent: false,
        }}
        selection={{ color: 'blue' }}
      >
        {(grid) => {
          handle = grid;
          return null;
        }}
      </CalendarGrid>
    ));
    const api = handle?.api();
    if (!api) throw new Error('Calendar did not mount');
    const host = container.querySelector<HTMLElement>('.calendar-view-host');
    expect(host?.style.getPropertyValue('--calendar-all-day-max-height')).toBe(
      '48px'
    );
    for (let index = 0; index < 3; index++) {
      api.addEvent({
        id: `event-${index}`,
        title: `Event ${index}`,
        start: '2026-11-02',
        end: '2026-11-03',
        allDay: true,
      });
      const overflow = container.querySelector('.fc-daygrid-more-link');
      if (index < 2) expect(overflow).toBeNull();
      else expect(overflow).not.toBeNull();
    }
    api.removeAllEvents();
    expect(container.querySelector('.fc-daygrid-more-link')).toBeNull();
    expect(host?.style.getPropertyValue('--calendar-all-day-max-height')).toBe(
      '48px'
    );
  });
  it.each([
    [
      'timeGridWeek',
      '--calendar-all-day-min-height',
      'var(--calendar-all-day-max-height)',
    ],
    ['timeGridThreeDay', 'height', '2rem'],
  ])('applies the phone-only spacing to %s', (view, property, value) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    document.documentElement.dataset.touchDevice = 'true';
    const wrapper = document.createElement('div');
    wrapper.className = 'calendar-view';
    const element = document.createElement('div');
    wrapper.append(element);
    document.body.append(wrapper);
    const style = document.createElement('style');
    style.textContent = readFileSync(
      'src/features/calendar/calendar-phone-grid.css',
      'utf8'
    );
    document.head.append(style);
    const grid = new Calendar(element, {
      plugins: [timeGridPlugin],
      initialView: view,
      initialDate: '2026-11-02',
      views: { timeGridThreeDay: { type: 'timeGrid', duration: { days: 3 } } },
    });
    try {
      grid.render();
      const rules = Array.from(style.sheet?.cssRules ?? [])
        .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule)
        .flatMap((media) => Array.from(media.cssRules))
        .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
      const spacing = rules.find(
        (rule) =>
          rule.style.getPropertyValue(property) === value &&
          wrapper.querySelector(rule.selectorText)
      );
      expect(spacing).toBeDefined();
      if (!spacing) throw new Error('Phone spacing rule missing');
      expect(style.sheet?.cssRules[0].cssText).toContain('max-width: 639px');
      for (const other of ['timeGridDay', 'timeGridWeek', 'timeGridThreeDay']) {
        grid.changeView(other);
        expect(!!wrapper.querySelector(spacing.selectorText)).toBe(
          other === view
        );
      }
      delete document.documentElement.dataset.touchDevice;
      expect(wrapper.querySelector(spacing.selectorText)).toBeNull();
    } finally {
      grid.destroy();
      wrapper.remove();
      style.remove();
      delete document.documentElement.dataset.touchDevice;
    }
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
  it.each([-1, 1])(
    'keeps three data-only ranges ahead across thirty moving pages (%s)',
    async (direction) => {
      vi.useFakeTimers();
      const viewport = document.createElement('div');
      Object.defineProperty(viewport, 'clientWidth', { value: 100 });
      viewport.getBoundingClientRect = () => new DOMRect(0, 0, 100, 0);
      let pager!: ReturnType<typeof useCalendarPager>;
      function Pages() {
        pager = useCalendarPager();
        return <CalendarPagePreloads />;
      }
      render(() => (
        <CalendarPagerContextProvider
          initialView="timeGridDay"
          initialDate={new Date(2026, 10, 15)}
          showWeekends={() => true}
          weekStartsOn={() => 0}
          onNavigate={() => {}}
          onViewChange={() => {}}
        >
          <Pages />
        </CalendarPagerContextProvider>
      ));
      const detach = pager.pager.attachViewport(viewport);
      const base = viewport.scrollLeft;
      try {
        for (let step = 1; step <= 30; step++) {
          viewport.scrollLeft = base + direction * step * 100;
          viewport.dispatchEvent(new Event('scroll'));
          await vi.advanceTimersByTimeAsync(16);
          const ahead = new Date(2026, 10, 15 + direction * (step + 6));
          expect(mocks.liveRanges.has(ahead.toISOString())).toBe(true);
          expect(mocks.liveRanges.size).toBeLessThanOrEqual(10);
          expect(pager.pager.pages()).toHaveLength(7);
        }
        const old = new Date(2026, 10, 15 - direction * 5);
        expect(mocks.liveRanges.has(old.toISOString())).toBe(false);
      } finally {
        detach();
      }
    }
  );

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

describe('the URL of details that followed a moved event', () => {
  const FROM = '2026-11-28T15:00:00+00:00';

  it('drops a link’s locator for the occurrence the move replaced', () => {
    mocks.searchEventId = 'event';
    mocks.searchOccurrenceKey = FROM;
    openCalendar();
    mocks.focusEvent('event');

    mocks.focusEvent('event', '2026-11-28T16:00:00+00:00');

    expect(mocks.setSearch).toHaveBeenCalledExactlyOnceWith(
      { eventId: 'event' },
      { mode: 'replace', history: 'replace' }
    );
  });

  it('drops a Home row’s dates, which carry no occurrence key', () => {
    mocks.searchEventId = 'event';
    mocks.searchStartDate = '2026-11-28';
    openCalendar();
    mocks.focusEvent('event');

    mocks.focusEvent('event', '2026-11-29T16:00:00+00:00');

    expect(mocks.setSearch).toHaveBeenCalledExactlyOnceWith(
      { eventId: 'event' },
      { mode: 'replace', history: 'replace' }
    );
  });

  it('keeps the URL of details opened from the grid, which names only the event', () => {
    mocks.searchEventId = 'event';
    openCalendar();
    mocks.focusEvent('event');

    mocks.focusEvent('event', '2026-11-29T16:00:00+00:00');

    expect(mocks.setSearch).not.toHaveBeenCalled();
  });

  it('keeps a link’s locator for the occurrence it still names', () => {
    mocks.searchEventId = 'event';
    mocks.searchOccurrenceKey = FROM;
    openCalendar();
    mocks.focusEvent('event');

    mocks.focusEvent('event', FROM);

    expect(mocks.setSearch).not.toHaveBeenCalled();
  });
});

describe('lightweight calendar page lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  it('keeps moving pages query-free and cancels a transient promotion', async () => {
    const rendered = vi.spyOn(Calendar.prototype, 'render');
    const [interactive, setInteractive] = createSignal(false);
    const [date, setDate] = createSignal(new Date(2026, 10, 1));
    let handle: CalendarPageRenderHandle | undefined;
    const { container } = render(() => (
      <CalendarPageRenderer
        date={date()}
        now={new Date()}
        dateInfo={calendarPageDateInfo(date(), 'timeGridDay', {
          weekStartsOn: 0,
          showWeekends: true,
          phone: false,
        })}
        interactive={interactive()}
        initialScrollTop={240}
        events={[]}
        eventsById={new Map()}
        settings={{
          initialView: 'timeGridDay',
          showWeekends: true,
          weekStartsOn: 0,
          timeFormat: '24-hour',
          useNarrowDayHeaders: false,
          useNarrowEventContent: false,
        }}
        selection={{ color: 'blue' }}
      >
        {(value) => {
          handle = value;
          return null;
        }}
      </CalendarPageRenderer>
    ));
    for (let day = 1; day <= 30; day++) {
      setDate(new Date(2026, 10, day));
      expect(handle?.dateInfo().start.getDate()).toBe(day);
    }
    setInteractive(true);
    setInteractive(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(rendered).not.toHaveBeenCalled();
    expect(handle?.api()).toBeUndefined();
    expect(container.querySelectorAll('.calendar-light-grid')).toHaveLength(1);
    rendered.mockRestore();
  });

  it('promotes only the settled current date and preserves scroll through demotion', async () => {
    const [interactive, setInteractive] = createSignal(true);
    const [date, setDate] = createSignal(new Date(2026, 10, 1));
    let handle: CalendarPageRenderHandle | undefined;
    const { container } = render(() => (
      <CalendarPageRenderer
        date={date()}
        now={new Date()}
        dateInfo={calendarPageDateInfo(date(), 'timeGridDay', {
          weekStartsOn: 0,
          showWeekends: true,
          phone: false,
        })}
        interactive={interactive()}
        initialScrollTop={240}
        events={[]}
        eventsById={new Map()}
        settings={{
          initialView: 'timeGridDay',
          showWeekends: true,
          weekStartsOn: 0,
          timeFormat: '24-hour',
          useNarrowDayHeaders: false,
          useNarrowEventContent: false,
        }}
        selection={{ color: 'blue' }}
      >
        {(value) => {
          handle = value;
          return null;
        }}
      </CalendarPageRenderer>
    ));
    await vi.advanceTimersByTimeAsync(100);
    expect(handle?.api()?.getDate()).toEqual(new Date(2026, 10, 1));
    expect(container.querySelectorAll('.calendar-light-grid')).toHaveLength(0);
    const interactiveRoot = handle?.element();
    expect(interactiveRoot?.classList.contains('calendar-view-host')).toBe(
      true
    );
    setInteractive(false);
    expect(handle?.element()).not.toBe(interactiveRoot);
    expect(handle?.element()?.classList.contains('calendar-light-grid')).toBe(
      true
    );
    setDate(new Date(2026, 11, 5));
    expect(handle?.api()).toBeUndefined();
    expect(container.querySelector('.calendar-light-scroller')?.scrollTop).toBe(
      240
    );
    setInteractive(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(handle?.api()?.getDate()).toEqual(new Date(2026, 11, 5));
    expect(
      container.querySelector('.fc-scroller-harness-liquid > .fc-scroller')
        ?.scrollTop
    ).toBe(240);
  });
});
