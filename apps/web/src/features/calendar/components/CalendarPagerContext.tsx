import { createRenderQueue } from '@app/lib/utils/create-render-queue';
import { createAssertedContextProvider } from '@core/context/createContext';
import type { Calendar, DatesSetArg } from '@fullcalendar/core';
import { createPager, type PagerController } from '@ui/components/Pager';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import type { CalendarOccurrenceData } from '../hooks/use-calendar-occurrence-data';
import type { CalendarEvent, CalendarPeriodView } from '../types';
import { timeGridScroller } from '../utils/time-grid-scroller';

export const CALENDAR_PAGE_IDS = ['previous', 'current', 'next'] as const;
export type CalendarPageId = (typeof CALENDAR_PAGE_IDS)[number];

interface CalendarPageHandle {
  id: CalendarPageId;
  api: Accessor<Calendar | undefined>;
  dateInfo: Accessor<DatesSetArg | undefined>;
  element: Accessor<HTMLDivElement | undefined>;
  data: CalendarOccurrenceData;
  /** Teammate out-of-office events overlaid on the page, when the surface
   * renders them. Kept out of `data` so occurrence-derived consumers (e.g.
   * availability) never mix in other people's events. */
  teamEvents?: Accessor<CalendarEvent[]>;
}

const shiftedDateForView = (
  date: Date,
  view: CalendarPeriodView,
  offset: -1 | 1
) => {
  const shifted = new Date(date);
  if (view === 'dayGridMonth') {
    shifted.setDate(1);
    shifted.setMonth(shifted.getMonth() + offset);
  } else {
    shifted.setDate(
      shifted.getDate() + (view === 'timeGridDay' ? offset : offset * 7)
    );
  }
  return shifted;
};

const navigateCalendar = (api: Calendar, view: string, date?: Date) => {
  if (api.view.type !== view) api.changeView(view, date);
  else if (date) api.gotoDate(date);
};

interface CalendarPagerContextProps extends ParentProps {
  [key: string]: unknown;
  initialView: CalendarPeriodView;
  showWeekends: Accessor<boolean>;
  weekStartsOn: Accessor<number>;
  onNavigate: () => void;
  onViewChange: (view: CalendarPeriodView) => void;
}

function createCalendarPagerContext(props: CalendarPagerContextProps) {
  const initialDate = new Date();
  const initialView = props.initialView;
  const initialDates: Record<CalendarPageId, Date> = {
    previous: shiftedDateForView(initialDate, initialView, -1),
    current: initialDate,
    next: shiftedDateForView(initialDate, initialView, 1),
  };

  const [pageOrder, setPageOrder] =
    createSignal<readonly CalendarPageId[]>(CALENDAR_PAGE_IDS);

  const [activePageId, setActivePageId] =
    createSignal<CalendarPageId>('current');

  const [listenForPageRegistryChange, notifyPageRegistryChange] =
    createSignal<void>(undefined, { equals: false });

  const pageHandles = new Map<CalendarPageId, CalendarPageHandle>();

  const pageHandle = (id: CalendarPageId) => {
    listenForPageRegistryChange();
    return pageHandles.get(id);
  };

  const activePage = createMemo(() => pageHandle(activePageId()));
  const activeData = createMemo(() => activePage()?.data);
  const activeDateInfo = createMemo(() => activePage()?.dateInfo());
  const renderQueue = createRenderQueue();
  // Arrow clicks accumulate against the requested date, not the last grid that
  // finished rendering. A newer request can replace an unfinished transition.
  const [requestedDate, setRequestedDate] = createSignal<Date>();
  let isDisposed = false;
  onCleanup(() => {
    isDisposed = true;
  });
  const navigationDate = () =>
    requestedDate() ??
    pageHandle(pager.targetPage() ?? activePageId())
      ?.dateInfo()
      ?.view.calendar.getDate();
  const clearRequestedDate = (date: Date) => {
    if (requestedDate() === date) setRequestedDate(undefined);
  };
  const periodView = () => props.initialView;
  const isChangingView = () => activeDateInfo()?.view.type !== periodView();

  const scrollElementFor = (handle: CalendarPageHandle | undefined) =>
    timeGridScroller(handle?.element());

  const copyActiveScrollPosition = () => {
    const activeScrollElement = scrollElementFor(activePage());
    if (!activeScrollElement) return;

    for (const id of pageOrder()) {
      if (id === activePageId()) continue;
      const scrollElement = scrollElementFor(pageHandle(id));
      if (!scrollElement) continue;

      scrollElement.scrollTop = activeScrollElement.scrollTop;
    }
  };

  const synchronizePage = (
    handle: CalendarPageHandle | undefined,
    source: CalendarPageHandle | undefined,
    direction: 'previous' | 'next'
  ) => {
    const api = handle?.api();
    const sourceApi = source?.api();
    if (!api || !sourceApi) return;

    api.batchRendering(() => {
      navigateCalendar(api, sourceApi.view.type, sourceApi.getDate());

      if (direction === 'previous') {
        api.prev();
      } else {
        api.next();
      }
    });
  };

  const queueBuffer = (id: CalendarPageId, direction: 'previous' | 'next') => {
    const source = activePage();
    renderQueue.enqueue(`buffer:${id}`, () => {
      synchronizePage(pageHandle(id), source, direction);
      copyActiveScrollPosition();
    });
  };

  const synchronizeBuffers = () => {
    const order = pageOrder();
    const activeIndex = order.indexOf(activePageId());
    const neighbors = [
      [order[activeIndex - 1], 'previous'],
      [order[activeIndex + 1], 'next'],
    ] as const;
    for (const [id, direction] of neighbors) {
      if (id) queueBuffer(id, direction);
    }
  };

  const rotatePages = (
    destination: CalendarPageId,
    direction: 'previous' | 'next'
  ) => {
    const order = pageOrder();
    const recycledId =
      direction === 'next' ? order[0] : order[order.length - 1];
    const nextOrder =
      direction === 'next'
        ? [...order.slice(1), order[0]]
        : [order[order.length - 1], ...order.slice(0, -1)];

    props.onNavigate();
    batch(() => {
      setPageOrder(nextOrder);
      setActivePageId(() => destination);
    });

    if (recycledId) queueBuffer(recycledId, direction);
  };

  const pager: PagerController<CalendarPageId> = createPager({
    pageOrder,
    activePage: activePageId,
    canChangePage: ({ to }) =>
      !isChangingView() &&
      !renderQueue.hasPending() &&
      pageHandle(to)?.api() !== undefined,
    onDragStart: copyActiveScrollPosition,
    onTransitionStart: () => {
      props.onNavigate();
      copyActiveScrollPosition();
    },
    onPageChange: (destination, { direction }) =>
      rotatePages(destination, direction),
  });

  const registerPage = (handle: CalendarPageHandle) => {
    pageHandles.set(handle.id, handle);
    notifyPageRegistryChange();

    return () => {
      if (pageHandles.get(handle.id) !== handle) return;
      pageHandles.delete(handle.id);
      notifyPageRegistryChange();
    };
  };

  let settingsSyncFrame: number | undefined;
  createEffect(
    on(
      () => [props.showWeekends(), props.weekStartsOn()],
      (_settings, previousSettings) => {
        if (previousSettings === undefined) return;
        if (settingsSyncFrame !== undefined) {
          cancelAnimationFrame(settingsSyncFrame);
        }
        settingsSyncFrame = requestAnimationFrame(() => {
          settingsSyncFrame = undefined;
          synchronizeBuffers();
        });
      }
    )
  );
  onCleanup(() => {
    if (settingsSyncFrame !== undefined) {
      cancelAnimationFrame(settingsSyncFrame);
    }
  });

  const updateSize = () => {
    listenForPageRegistryChange();

    for (const handle of pageHandles.values()) {
      handle.api()?.updateSize();
    }
  };

  const scheduleActiveUpdate = () => {
    pager.cancel();
    renderQueue.clear();
    renderQueue.enqueue(
      'active',
      () => {
        const api = activePage()?.api();
        if (!api) return;
        const date = requestedDate();
        navigateCalendar(api, periodView(), date);
        if (date) clearRequestedDate(date);
        synchronizeBuffers();
      },
      true
    );
  };

  const gotoDate = (date: Date) => {
    setRequestedDate(date);
    props.onNavigate();
    scheduleActiveUpdate();
  };

  const finishDateNavigation = async (
    transition: Promise<boolean>,
    date: Date,
    onCommit?: () => void
  ) => {
    const changed = await transition;
    if (isDisposed || requestedDate() !== date) return;
    if (changed) {
      clearRequestedDate(date);
      onCommit?.();
    } else {
      gotoDate(date);
    }
  };

  const navigatePeriod = (direction: 'previous' | 'next') => {
    const date = navigationDate();
    if (!date) return;
    const target = shiftedDateForView(
      date,
      periodView(),
      direction === 'previous' ? -1 : 1
    );
    // Preserve the normal slide for a single click. Repeated clicks bypass the
    // animation and stale buffers, coalescing directly to the latest date.
    if (
      requestedDate() ||
      pager.phase() !== 'idle' ||
      isChangingView() ||
      renderQueue.hasPending()
    ) {
      gotoDate(target);
      return;
    }
    setRequestedDate(target);
    const transition =
      direction === 'previous' ? pager.previous() : pager.next();
    void finishDateNavigation(transition, target);
  };

  const navigateToDate = (date: Date) => {
    // A date aim can arrive before a period's hidden buffers are ready. Page
    // transitions reject that destination; aim the active grid directly instead.
    if (requestedDate() || isChangingView() || renderQueue.hasPending()) {
      gotoDate(date);
      return;
    }
    pager.cancel();
    // A newer date aim supersedes any deferred gotoDate, even when the newer
    // aim uses a page transition rather than the active-grid navigation path.
    renderQueue.clear();

    const sourceApi = activePage()?.api();
    if (!sourceApi) return;

    if (
      date >= sourceApi.view.currentStart &&
      date < sourceApi.view.currentEnd
    ) {
      gotoDate(date);
      return;
    }

    const direction = date < sourceApi.view.currentStart ? 'previous' : 'next';
    const order = pageOrder();
    const activeIndex = order.indexOf(activePageId());
    const destinationId =
      direction === 'previous'
        ? order[activeIndex - 1]
        : order[activeIndex + 1];
    const destinationApi = destinationId
      ? pageHandle(destinationId)?.api()
      : undefined;

    if (!destinationApi) {
      gotoDate(date);
      return;
    }

    setRequestedDate(date);
    destinationApi.batchRendering(() =>
      navigateCalendar(destinationApi, sourceApi.view.type, date)
    );

    const transition =
      direction === 'previous' ? pager.previous() : pager.next();
    void finishDateNavigation(transition, date, synchronizeBuffers);
  };

  const changeView = (view: CalendarPeriodView) => {
    if (periodView() === view) return;
    pager.cancel();
    props.onNavigate();
    props.onViewChange(view);
  };

  // Route changes and date jumps share one coalesced active-grid update.
  createEffect(
    on([periodView, () => activePage()?.api()], ([view, api], previous) => {
      if (!api) return;
      if (api.view.type === view && (!previous || previous[0] === view)) return;
      scheduleActiveUpdate();
    })
  );

  return {
    pager,
    pageOrder,
    periodView,
    isChangingView,
    activePageId,
    activePage,
    activeData,
    activeDateInfo,
    navigationDate,
    activeTeamEvents: () => activePage()?.teamEvents?.() ?? [],
    visibleRange: () => activeData()?.range(),
    initialDateFor: (id: CalendarPageId) => initialDates[id],
    isActive: (id: CalendarPageId) => activePageId() === id,
    registerPage,
    updateSize,
    gotoDate,
    navigateToDate,
    navigateToToday: () => navigateToDate(new Date()),
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
