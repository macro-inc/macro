import { beginInteraction } from '@app/observability/flow';
import { createAssertedContextProvider } from '@core/context/createContext';
import { isMobile } from '@core/mobile/isMobile';
import type { Calendar, DatesSetArg } from '@fullcalendar/core';
import { Telemetry } from '@macro-inc/observability';
import { createSnapPager } from '@ui/components/SnapPager/SnapPager';
import {
  differenceInCalendarDays,
  differenceInCalendarMonths,
  startOfWeek,
} from 'date-fns';
import {
  type Accessor,
  batch,
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type ParentProps,
  untrack,
} from 'solid-js';
import { calendarPageRange } from '../core/page-range';
import type { CalendarOccurrenceData } from '../hooks/use-calendar-occurrence-data';
import type { CalendarEvent, CalendarGridPeriodView } from '../types';
import { timeGridScroller } from '../utils/time-grid-scroller';

export type CalendarPageId = number;

interface DateAnchor {
  date: Date;
  position: number;
}
interface PageMovement {
  position: number;
  direction: number;
}

interface CalendarPageHandle {
  id: CalendarPageId;
  api: Accessor<Calendar | undefined>;
  dateInfo: Accessor<DatesSetArg | undefined>;
  element: Accessor<HTMLDivElement | undefined>;
  data: CalendarOccurrenceData;
  teamEvents?: Accessor<CalendarEvent[]>;
}

const shiftedDateForView = (
  date: Date,
  view: CalendarGridPeriodView,
  offset: number
) => {
  const shifted = new Date(date);
  if (view === 'dayGridMonth' && offset !== 0) {
    shifted.setDate(1);
    shifted.setMonth(shifted.getMonth() + offset);
  } else {
    const days =
      view === 'timeGridDay' ? 1 : view === 'timeGridThreeDay' ? 3 : 7;
    shifted.setDate(shifted.getDate() + offset * days);
  }
  return shifted;
};

const navigateCalendar = (api: Calendar, view: string, date: Date) => {
  if (api.view.type !== view) api.changeView(view, date);
  else api.gotoDate(date);
};

interface CalendarPagerContextProps extends ParentProps {
  [key: string]: unknown;
  initialView: CalendarGridPeriodView;
  initialDate?: Date;
  initialScrollTop?: number;
  showWeekends: Accessor<boolean>;
  weekStartsOn: Accessor<number>;
  onNavigate: () => void;
  onViewChange: (view: CalendarGridPeriodView) => void;
}

function createCalendarPagerContext(props: CalendarPagerContextProps) {
  const [anchor, setAnchor] = createSignal<DateAnchor>({
    date: props.initialDate ?? new Date(),
    position: 0,
  });
  const [registryRevision, notifyRegistry] = createSignal(undefined, {
    equals: false,
  });
  const handles = new Map<CalendarPageId, CalendarPageHandle>();
  const rendered = new Map<CalendarPageId, string>();
  const periodView = () => props.initialView;
  let sharedScrollTop = props.initialScrollTop;
  let scrollViewportSize: { width: number; height: number } | undefined;
  let pendingDate: Date | undefined;
  let todayTarget: Date | undefined;
  let todayFrame: number | undefined;

  const pager = createSnapPager({
    onSettle() {
      if (pendingDate) {
        const date = pendingDate;
        const scrollToNow = todayTarget === date;
        pendingDate = undefined;
        gotoDate(date);
        if (scrollToNow) todayTarget = date;
      }
      if (todayTarget) scrollToToday();
    },
    onNavigationCancel() {
      pendingDate = undefined;
      todayTarget = undefined;
    },
  });
  const activePageId = pager.activePage;
  const pageHandle = (id: CalendarPageId) => {
    registryRevision();
    return handles.get(id);
  };
  const activePage = createMemo(() => pageHandle(activePageId()));
  const activeData = createMemo(() => activePage()?.data);
  const activeDateInfo = createMemo(() => activePage()?.dateInfo());
  const dateAt = (position: number) =>
    shiftedDateForView(
      anchor().date,
      periodView(),
      position - anchor().position
    );
  const activeDate = () => dateAt(pager.position());
  // Navigation and heading follow the viewport centre, not a settled anchor.
  const navigationDate = activeDate;
  const isChangingView = () => activeDateInfo()?.view.type !== periodView();
  const pageDate = (id: CalendarPageId) => dateAt(pager.pages()[id].position());
  const signature = (date: Date) => `${periodView()}:${date.getTime()}`;
  const preloadRange = (position: number) =>
    calendarPageRange(dateAt(position), periodView(), {
      weekStartsOn: props.weekStartsOn() === 1 ? 1 : 0,
      showWeekends: props.showWeekends(),
      phone: isMobile(),
    });
  const movement = createMemo<PageMovement>(
    (previous) => {
      const position = pager.position();
      return {
        position,
        direction:
          Math.sign(position - previous.position) || previous.direction,
      };
    },
    { position: 0, direction: 1 }
  );
  const preloadPositions = createMemo(() => {
    const position = pager.position();
    // The pool already keeps three pages behind the viewport for a reversal.
    // Add only three data-only ranges ahead, limiting the window to ten queried ranges.
    const first = position - 3 - (movement().direction < 0 ? 3 : 0);
    const last = position + 3 + (movement().direction > 0 ? 3 : 0);
    return Array.from(
      { length: last - first + 1 },
      (_, index) => first + index
    ).sort((a, b) => Math.abs(a - position) - Math.abs(b - position));
  });

  const copyScrollPosition = () => {
    const source = timeGridScroller(activePage()?.element());
    if (source && scrollViewportSize) {
      const widthChanged = source.clientWidth !== scrollViewportSize.width;
      const heightChanged = source.clientHeight !== scrollViewportSize.height;
      if (widthChanged || heightChanged) return;
    }
    // A hidden grid clamps scrollTop to zero before it has geometry.
    if (source && source.clientHeight > 0 && source.scrollHeight > 0)
      sharedScrollTop = source.scrollTop;
    if (sharedScrollTop === undefined) return;
    for (const handle of handles.values()) {
      if (handle.id === activePageId()) continue;
      const target = timeGridScroller(handle.element());
      if (target && target.scrollTop !== sharedScrollTop)
        target.scrollTop = sharedScrollTop;
    }
  };

  function synchronizePages(force = false) {
    for (const page of pager.pages()) {
      const handle = handles.get(page.key);
      if (!handle) continue;
      const date = pageDate(page.key);
      const key = signature(date);
      if (!force && rendered.get(page.key) === key) continue;
      const api = handle.api();
      if (!api) continue;
      // Publish the signature first: datesSet can synchronously notify Solid.
      rendered.set(page.key, key);
      const span = Telemetry.span('calendar.page.reassign', {
        sampling: 'perf',
      });
      span.setAttr('calendar.view', periodView());
      try {
        span.run(() => {
          api.batchRendering(() => navigateCalendar(api, periodView(), date));
          const scroller = timeGridScroller(handle.element());
          if (scroller && sharedScrollTop !== undefined)
            scroller.scrollTop = sharedScrollTop;
        });
      } finally {
        span.end();
      }
    }
  }

  // Computed work runs with slot assignment before DOM paint. No idle queue or
  // settlement gate can leave a recycled slot showing its previous dates.
  createComputed(() => {
    pager.pages().forEach((page) => page.position());
    anchor();
    periodView();
    untrack(() => synchronizePages());
  });
  createComputed(
    on(pager.position, (position, previous) => {
      if (previous === undefined || previous === position) return;
      props.onNavigate();
    })
  );

  const initialDateFor = (id: CalendarPageId) => {
    const date = pageDate(id);
    rendered.set(id, signature(date));
    return date;
  };
  const registerPage = (handle: CalendarPageHandle) => {
    handles.set(handle.id, handle);
    notifyRegistry();
    synchronizePages();
    return () => {
      if (handles.get(handle.id) !== handle) return;
      handles.delete(handle.id);
      rendered.delete(handle.id);
      notifyRegistry();
    };
  };

  createEffect(
    on(
      () => [activePage()?.element(), activeDateInfo()],
      () => {
        const scroller = timeGridScroller(activePage()?.element());
        if (!scroller) return;
        scrollViewportSize = {
          width: scroller.clientWidth,
          height: scroller.clientHeight,
        };
        if (sharedScrollTop !== undefined) scroller.scrollTop = sharedScrollTop;
        copyScrollPosition();
        scroller.addEventListener('scroll', copyScrollPosition, {
          passive: true,
        });
        onCleanup(() =>
          scroller.removeEventListener('scroll', copyScrollPosition)
        );
      }
    )
  );

  function gotoDate(date: Date) {
    if (pager.locked()) return;
    // A far jump may re-anchor the virtual dates only after native ownership
    // ends. Ordinary scrolling never changes the anchor or scrollLeft.
    if (pager.nativeScrolling()) {
      pendingDate = date;
      return;
    }
    const interaction = beginInteraction('calendar.page');
    try {
      props.onNavigate();
      todayTarget = undefined;
      batch(() => {
        setAnchor({ date, position: 0 });
        pager.reset();
      });
    } finally {
      interaction.end();
    }
  }
  function scrollToToday() {
    if (todayFrame !== undefined) cancelAnimationFrame(todayFrame);
    todayFrame = requestAnimationFrame(() => {
      todayFrame = undefined;
      const now = todayTarget;
      if (!now) return;
      activePage()
        ?.api()
        ?.scrollToTime({
          minutes: Math.max(0, now.getHours() * 60 + now.getMinutes() - 60),
        });
      copyScrollPosition();
      todayTarget = undefined;
    });
  }
  const navigateToToday = () => {
    if (pager.locked()) return;
    const now = new Date();
    gotoDate(now);
    todayTarget = now;
    if (pager.phase() === 'idle') scrollToToday();
  };
  const navigatePeriod = (direction: 'previous' | 'next') => {
    if (!pager.canStep()) return;
    const interaction = beginInteraction('calendar.page');
    try {
      pendingDate = undefined;
      todayTarget = undefined;
      props.onNavigate();
      if (direction === 'previous') pager.previous();
      else pager.next();
    } finally {
      interaction.end();
    }
  };
  const navigateToDate = (date: Date) => {
    if (pager.locked()) return;
    const current = dateAt(pager.targetPosition());
    let offset: number;
    const view = periodView();
    if (view === 'dayGridMonth')
      offset = differenceInCalendarMonths(date, current);
    else if (view === 'timeGridWeek') {
      const weekStartsOn = props.weekStartsOn() === 1 ? 1 : 0;
      offset =
        differenceInCalendarDays(
          startOfWeek(date, { weekStartsOn }),
          startOfWeek(current, { weekStartsOn })
        ) / 7;
    } else {
      const days = differenceInCalendarDays(date, current);
      if (view === 'timeGridThreeDay' && days % 3 !== 0) {
        gotoDate(date);
        return;
      }
      offset = days / (view === 'timeGridThreeDay' ? 3 : 1);
    }
    if (Math.abs(offset) !== 1) {
      gotoDate(date);
      return;
    }
    pendingDate = undefined;
    todayTarget = undefined;
    props.onNavigate();
    batch(() => {
      setAnchor({ date, position: pager.targetPosition() + offset });
      pager.goTo(offset);
    });
  };
  const changeView = (view: CalendarGridPeriodView) => {
    if (periodView() === view) return;
    const date = navigationDate();
    pendingDate = undefined;
    todayTarget = undefined;
    batch(() => {
      setAnchor({ date, position: 0 });
      pager.reset();
    });
    props.onNavigate();
    props.onViewChange(view);
  };
  createEffect(
    on(
      [periodView, props.showWeekends, props.weekStartsOn],
      (_value, previous) => {
        if (previous) synchronizePages(true);
      }
    )
  );
  onCleanup(() => {
    if (todayFrame !== undefined) cancelAnimationFrame(todayFrame);
  });

  return {
    pager,
    periodView,
    isChangingView,
    activePageId,
    activePage,
    activeData,
    activeDateInfo,
    activeDate,
    navigationDate,
    activeTeamEvents: () => activePage()?.teamEvents?.() ?? [],
    pageRange: (id: CalendarPageId) =>
      preloadRange(pager.pages()[id].position()),
    preloadRange,
    preloadPositions,
    visibleRange: () => activeData()?.range(),
    initialDateFor,
    scrollTop: () => sharedScrollTop,
    registerPage,
    isActive: (id: CalendarPageId) => activePageId() === id,
    updateSize: () => {
      const scrollTop = sharedScrollTop;
      for (const handle of handles.values()) handle.api()?.updateSize();
      const activeScroller = timeGridScroller(activePage()?.element());
      if (activeScroller)
        scrollViewportSize = {
          width: activeScroller.clientWidth,
          height: activeScroller.clientHeight,
        };
      if (scrollTop === undefined) return;
      sharedScrollTop = scrollTop;
      for (const handle of handles.values()) {
        const scroller = timeGridScroller(handle.element());
        if (scroller) scroller.scrollTop = scrollTop;
      }
    },
    setPagingLocked: pager.setLocked,
    gotoDate,
    navigateToDate,
    navigateToToday,
    previousPeriod: () => navigatePeriod('previous'),
    nextPeriod: () => navigatePeriod('next'),
    changeView,
  };
}

export const [CalendarPagerContextProvider, useCalendarPager] =
  createAssertedContextProvider<
    ReturnType<typeof createCalendarPagerContext>,
    CalendarPagerContextProps
  >('CalendarPagerContext', createCalendarPagerContext);
