import { createAssertedContextProvider } from '@core/context/createContext';
import type { Calendar, DatesSetArg, EventInput } from '@fullcalendar/core';
import type {
  CalendarOccurrenceQueryRange,
  useCalendarOccurrencesQuery,
} from '@queries/calendar/occurrences';
import { createPager, type PagerController } from '@ui/components/Pager';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { useCalendarView } from './CalendarViewContext';
import type { CalendarEvent, CalendarPeriodView } from './events/types';

export const CALENDAR_PAGE_IDS = ['previous', 'current', 'next'] as const;
export type CalendarPageId = (typeof CALENDAR_PAGE_IDS)[number];

const TIME_GRID_SCROLLER_SELECTOR =
  '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller';

export interface CalendarPageData {
  range: Accessor<CalendarOccurrenceQueryRange | undefined>;
  occurrencesQuery: ReturnType<typeof useCalendarOccurrencesQuery>;
  events: Accessor<CalendarEvent[]>;
  eventsById: Accessor<Map<string, CalendarEvent>>;
  fullCalendarEvents: Accessor<EventInput[]>;
  isLoading: Accessor<boolean>;
  isSyncing: Accessor<boolean>;
}

export interface CalendarPageHandle {
  id: CalendarPageId;
  api: Accessor<Calendar | undefined>;
  dateInfo: Accessor<DatesSetArg | undefined>;
  element: Accessor<HTMLDivElement | undefined>;
  data: CalendarPageData;
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

export const [CalendarPagerContextProvider, useCalendarPager] =
  createAssertedContextProvider('CalendarPagerContext', () => {
    const calendarView = useCalendarView();

    const initialDate = new Date();
    const initialView = calendarView.displaySettings.periodView;
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

    const scrollElementFor = (handle: CalendarPageHandle | undefined) => {
      const element = handle?.element();
      if (!element) return undefined;

      return element.querySelector<HTMLElement>(TIME_GRID_SCROLLER_SELECTOR);
    };

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

      const date = sourceApi.getDate();
      const view = sourceApi.view.type;
      api.batchRendering(() => {
        if (api.view.type === view) {
          api.gotoDate(date);
        } else {
          api.changeView(view, date);
        }

        if (direction === 'previous') {
          api.prev();
        } else {
          api.next();
        }
      });
    };

    const synchronizeBuffers = () => {
      const order = pageOrder();
      const activeIndex = order.indexOf(activePageId());
      const current = activePage();
      const previousId = order[activeIndex - 1];
      const nextId = order[activeIndex + 1];
      if (previousId) {
        synchronizePage(pageHandle(previousId), current, 'previous');
      }

      if (nextId) {
        synchronizePage(pageHandle(nextId), current, 'next');
      }

      requestAnimationFrame(copyActiveScrollPosition);
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

      calendarView.closeEventDetails();
      batch(() => {
        setPageOrder(nextOrder);
        setActivePageId(() => destination);
      });

      const current = pageHandle(destination);
      synchronizePage(pageHandle(recycledId), current, direction);
      requestAnimationFrame(copyActiveScrollPosition);
    };

    const pager: PagerController<CalendarPageId> = createPager({
      pageOrder,
      activePage: activePageId,
      canChangePage: ({ to }) => pageHandle(to)?.api() !== undefined,
      onDragStart: copyActiveScrollPosition,
      onTransitionStart: () => {
        calendarView.closeEventDetails();
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
        () => [
          calendarView.displaySettings.showWeekends,
          calendarView.displaySettings.weekStartsOn,
        ],
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

    const gotoDate = (date: Date) => {
      pager.cancel();
      calendarView.closeEventDetails();
      activePage()?.api()?.gotoDate(date);
      synchronizeBuffers();
    };

    const navigateToDate = (date: Date) => {
      pager.cancel();

      const sourceApi = activePage()?.api();
      if (!sourceApi) return;

      if (
        date >= sourceApi.view.currentStart &&
        date < sourceApi.view.currentEnd
      ) {
        gotoDate(date);
        return;
      }

      const direction =
        date < sourceApi.view.currentStart ? 'previous' : 'next';
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

      destinationApi.batchRendering(() => {
        if (destinationApi.view.type === sourceApi.view.type) {
          destinationApi.gotoDate(date);
        } else {
          destinationApi.changeView(sourceApi.view.type, date);
        }
      });

      const transition =
        direction === 'previous' ? pager.previous() : pager.next();
      void transition.then(synchronizeBuffers);
    };

    const changeView = (view: CalendarPeriodView) => {
      calendarView.setPeriodView(view);

      const api = activePage()?.api();
      if (!api || api.view.type === view) return;
      pager.cancel();
      calendarView.closeEventDetails();
      api.changeView(view);
      synchronizeBuffers();
    };

    return {
      pager,
      pageOrder,
      activePageId,
      activePage,
      activeData,
      activeDateInfo,
      visibleRange: () => activeData()?.range(),
      initialDateFor: (id: CalendarPageId) => initialDates[id],
      isActive: (id: CalendarPageId) => activePageId() === id,
      registerPage,
      updateSize,
      gotoDate,
      navigateToDate,
      navigateToToday: () => navigateToDate(new Date()),
      changeView,
    };
  });
