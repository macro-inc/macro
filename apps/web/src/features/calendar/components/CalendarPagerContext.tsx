import { createRenderQueue } from '@app/lib/utils/create-render-queue';
import { beginInteraction } from '@app/observability/flow';
import { createAssertedContextProvider } from '@core/context/createContext';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { Calendar, DatesSetArg } from '@fullcalendar/core';
import { createSnapPager } from '@ui/components/SnapPager/SnapPager';
import {
  differenceInCalendarDays,
  differenceInCalendarMonths,
  startOfWeek,
} from 'date-fns';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import type { CalendarOccurrenceData } from '../hooks/use-calendar-occurrence-data';
import type { CalendarEvent, CalendarGridPeriodView } from '../types';
import { isSameLocalDate } from '../utils/calendar-date';
import { timeGridScroller } from '../utils/time-grid-scroller';

export const CALENDAR_PAGE_COUNT = 5;
export type CalendarPageId = number;

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

interface DateAnchor {
  date: Date;
  position: number;
}
interface CalendarNavigationState {
  anchor: DateAnchor;
  pendingAnchor: DateAnchor | undefined;
  requestedDate: Date | undefined;
}

function createCalendarPagerContext(props: CalendarPagerContextProps) {
  const initialDate = props.initialDate ?? new Date();
  const [navigation, setNavigation] = createStore<CalendarNavigationState>({
    anchor: { date: initialDate, position: 0 },
    pendingAnchor: undefined,
    requestedDate: undefined,
  });
  const anchor = () => navigation.anchor;
  const pendingAnchor = () => navigation.pendingAnchor;
  const requestedDate = () => navigation.requestedDate;
  const setAnchor = (value: DateAnchor) => setNavigation('anchor', value);
  const setPendingAnchor = (value: DateAnchor | undefined) =>
    setNavigation('pendingAnchor', value);
  const setRequestedDate = (value: Date | undefined) =>
    setNavigation('requestedDate', value);
  let todayTarget: Date | undefined;
  const [registryRevision, notifyRegistry] = createSignal(undefined, {
    equals: false,
  });
  const handles = new Map<CalendarPageId, CalendarPageHandle>();
  const rendered = new Map<CalendarPageId, string>();
  const renderQueue = createRenderQueue();
  const periodView = () => props.initialView;
  let sharedScrollTop = props.initialScrollTop;
  let scrollViewportSize: { width: number; height: number } | undefined;

  const pager = createSnapPager({
    discrete: () => !isTouchDevice(),
    onWheelNavigate: (direction) => preparePeriodNavigation(direction),
    onScrollStart() {
      renderQueue.clear();
    },
    onNavigationCancel() {
      setPendingAnchor(undefined);
      setRequestedDate(undefined);
      todayTarget = undefined;
      if (pager.phase() === 'idle') synchronizePages();
    },
    onSettle(moved) {
      if (moved !== 0) props.onNavigate();
      const pending = pendingAnchor();
      if (pending?.position === pager.position()) {
        setAnchor(pending);
        setPendingAnchor(undefined);
      } else if (moved === 0) {
        setPendingAnchor(undefined);
        setRequestedDate(undefined);
      }
      const requested = requestedDate();
      if (requested && isSameLocalDate(requested, activeDate()))
        setRequestedDate(undefined);
      synchronizePages();
      if (todayTarget && !pendingAnchor()) queueTodayScroll(todayTarget);
    },
  });
  const activePageId = pager.activePage;
  const pageOrder = pager.pageOrder;
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
  const navigationDate = () => requestedDate() ?? activeDate();
  const isChangingView = () => activeDateInfo()?.view.type !== periodView();
  const pageDate = (id: CalendarPageId) =>
    dateAt(pager.position() + (pager.pages()[id]?.offset() ?? 0));
  const signature = (date: Date) => `${periodView()}:${date.getTime()}`;

  const copyScrollPosition = () => {
    const source = timeGridScroller(activePage()?.element());
    // Layout can clamp scrollTop and emit scroll before our resize callback.
    // Keep the user anchor until updateSize restores it in the new geometry.
    if (source && scrollViewportSize) {
      const widthChanged = source.clientWidth !== scrollViewportSize.width;
      const heightChanged = source.clientHeight !== scrollViewportSize.height;
      if (widthChanged || heightChanged) return;
    }
    // A hidden/remounting grid clamps scrollTop to zero before it has geometry.
    // Keep the history offset until the opening-scroll hook can apply it.
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

  // Recycled pages alone get new dates. Read their latest position inside each
  // job, so another native swipe never waits on or commits an obsolete buffer.
  function synchronizePages(force = false) {
    if (pager.phase() !== 'idle') return;
    for (const id of pageOrder()) {
      if (!handles.has(id)) continue;
      if (!force && rendered.get(id) === signature(pageDate(id))) continue;
      renderQueue.enqueue(
        `page:${id}`,
        () => {
          if (pager.phase() !== 'idle') return;
          const handle = handles.get(id);
          const api = handle?.api();
          if (!api) return;
          const date = pageDate(id);
          navigateCalendar(api, periodView(), date);
          rendered.set(id, signature(date));
          const scroller = timeGridScroller(handle?.element());
          if (scroller && sharedScrollTop !== undefined)
            scroller.scrollTop = sharedScrollTop;
          if (id === activePageId()) {
            const requested = requestedDate();
            if (requested && isSameLocalDate(requested, date))
              setRequestedDate(undefined);
          }
        },
        id === activePageId()
      );
    }
  }

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

  const gotoDate = (date: Date) => {
    if (pager.locked()) return;
    const interaction = beginInteraction('calendar.page');
    try {
      todayTarget = undefined;
      renderQueue.clear();
      props.onNavigate();
      setPendingAnchor({
        date,
        position: pager.targetPosition() + CALENDAR_PAGE_COUNT,
      });
      setRequestedDate(date);
      pager.goTo(CALENDAR_PAGE_COUNT);
    } finally {
      interaction.end();
    }
  };
  function queueTodayScroll(now: Date) {
    renderQueue.enqueue('scroll-to-now', () => {
      if (todayTarget !== now) return;
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
    const now = new Date();
    gotoDate(now);
    todayTarget = now;
    if (pager.phase() === 'idle') queueTodayScroll(now);
  };
  function preparePeriodNavigation(delta: number) {
    todayTarget = undefined;
    renderQueue.clear();
    const target = shiftedDateForView(navigationDate(), periodView(), delta);
    const pending = pendingAnchor();
    if (pending)
      setPendingAnchor({ date: target, position: pending.position + delta });
    setRequestedDate(target);
    props.onNavigate();
  }
  const navigatePeriod = (direction: 'previous' | 'next') => {
    if (!pager.canStep()) return;
    const interaction = beginInteraction('calendar.page');
    try {
      preparePeriodNavigation(direction === 'previous' ? -1 : 1);
      if (direction === 'previous') pager.previous();
      else pager.next();
    } finally {
      interaction.end();
    }
  };
  const navigateToDate = (date: Date) => {
    const current = activeDate();
    const view = periodView();
    let offset: number;
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
      offset = Math.floor(
        differenceInCalendarDays(date, current) /
          (view === 'timeGridThreeDay' ? 3 : 1)
      );
    }
    if (Math.abs(offset) !== 1 || requestedDate()) {
      gotoDate(date);
      return;
    }
    const interaction = beginInteraction('calendar.page');
    try {
      renderQueue.clear();
      props.onNavigate();
      setPendingAnchor({ date, position: pager.targetPosition() + offset });
      setRequestedDate(date);
      // Prepare only the hidden destination for an explicit adjacent date.
      // Never re-date the visible page while it is still under the user's finger.
      if (pager.phase() === 'idle') {
        const destination = pager
          .pages()
          .find((page) => page.offset() === offset);
        const api = destination
          ? handles.get(destination.key)?.api()
          : undefined;
        if (api && destination) {
          navigateCalendar(api, view, date);
          rendered.set(destination.key, signature(date));
        }
      }
      pager.goTo(offset);
    } finally {
      interaction.end();
    }
  };
  const changeView = (view: CalendarGridPeriodView) => {
    if (periodView() === view) return;
    const date = navigationDate();
    todayTarget = undefined;
    setPendingAnchor(undefined);
    renderQueue.clear();
    pager.reset();
    setAnchor({ date, position: 0 });
    setRequestedDate(undefined);
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
    visibleRange: () => activeData()?.range(),
    initialDateFor,
    scrollTop: () => sharedScrollTop,
    registerPage,
    isActive: (id: CalendarPageId) => activePageId() === id,
    updateSize: () => {
      // Read the last user scroll event, not FullCalendar's already-reset scroller.
      const scrollTop = sharedScrollTop;
      for (const handle of handles.values()) handle.api()?.updateSize();
      const activeScroller = timeGridScroller(activePage()?.element());
      if (activeScroller) {
        scrollViewportSize = {
          width: activeScroller.clientWidth,
          height: activeScroller.clientHeight,
        };
      }
      // FullCalendar can reset the hour scroller while recomputing its layout.
      // Restore the captured active position to every page after all updates.
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
