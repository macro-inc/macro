import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import {
  type CalendarOccurrenceQueryRange,
  createCalendarOccurrenceQueryRange,
  useCalendarOccurrencesQuery,
} from '@queries/calendar/occurrences';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { createEffect, createMemo, createSignal, on } from 'solid-js';
import { createStore } from 'solid-js/store';
import { isCalendarRangeSupported } from './calendar-supported-range';
import {
  DEFAULT_CALENDAR_SOURCE,
  mapCalendarOccurrence,
} from './events/calendar-occurrence-mapper';
import { mapCalendarEventToFullCalendar } from './events/event-mapper';
import type { CalendarTimeFormat, CalendarWeekStart } from './events/types';
import { getDefaultCalendarTimeFormat } from './time-format';

interface CalendarEventState {
  visibleSourceIds: string[];
  selectedEventId: string | undefined;
}

interface CalendarDisplaySettings {
  showWeekends: boolean;
  weekStartsOn: CalendarWeekStart;
  timeFormat: CalendarTimeFormat;
}

const CALENDAR_SOURCES = [DEFAULT_CALENDAR_SOURCE];

export const [CalendarViewContextProvider, useCalendarView] =
  createAssertedContextProvider('CalendarViewContext', () => {
    const userId = useUserId();
    const [visibleRange, setVisibleRange] =
      createSignal<CalendarOccurrenceQueryRange>();
    const [eventState, setEventState] = createStore<CalendarEventState>({
      visibleSourceIds: CALENDAR_SOURCES.map((source) => source.id),
      selectedEventId: undefined,
    });

    const [displaySettings, setDisplaySettings] =
      createStore<CalendarDisplaySettings>({
        showWeekends: true,
        weekStartsOn: 0,
        timeFormat: getDefaultCalendarTimeFormat(),
      });

    const [selectedEventAnchor, setSelectedEventAnchor] =
      createSignal<HTMLElement>();
    const [useNarrowDayHeaders, setUseNarrowDayHeaders] = createSignal(false);

    const isVisibleRangeSupported = createMemo(() => {
      const range = visibleRange();
      return range !== undefined && isCalendarRangeSupported(range);
    });
    const occurrencesQuery = useCalendarOccurrencesQuery(
      () => ({ userId: userId(), range: visibleRange() }),
      () => ({ enabled: isVisibleRangeSupported() })
    );
    const events = createMemo(() =>
      isVisibleRangeSupported()
        ? (occurrencesQuery.data?.items ?? []).map(mapCalendarOccurrence)
        : []
    );
    const visibleEvents = createMemo(() =>
      events().filter((event) =>
        eventState.visibleSourceIds.includes(event.calendar.id)
      )
    );
    const eventsById = createMemo(
      () => new Map(events().map((event) => [event.id, event]))
    );
    const selectedEvent = createMemo(() => {
      const eventId = eventState.selectedEventId;
      return eventId ? eventsById().get(eventId) : undefined;
    });
    const fullCalendarEvents = createMemo(() =>
      visibleEvents().map(mapCalendarEventToFullCalendar)
    );
    const isLoading = () =>
      visibleRange() === undefined ||
      (isVisibleRangeSupported() && occurrencesQuery.isPending);
    const isSyncing = () =>
      occurrencesQuery.data?.syncStatus === CalendarSyncStatus.syncing;

    const closeEventDetails = () => {
      setEventState('selectedEventId', undefined);
      setSelectedEventAnchor(undefined);
    };

    createEffect(
      on(
        () =>
          [eventState.selectedEventId, occurrencesQuery.dataUpdatedAt] as const,
        ([selectedEventId]) => {
          if (
            selectedEventId &&
            occurrencesQuery.isSuccess &&
            !eventsById().has(selectedEventId)
          ) {
            closeEventDetails();
          }
        }
      )
    );

    const updateVisibleRange = (start: Date, end: Date) => {
      const nextRange = createCalendarOccurrenceQueryRange(start, end);
      const currentRange = visibleRange();

      if (
        currentRange?.start === nextRange.start &&
        currentRange.end === nextRange.end &&
        currentRange.startDate === nextRange.startDate &&
        currentRange.endDate === nextRange.endDate
      ) {
        return;
      }

      closeEventDetails();
      setVisibleRange(nextRange);
    };

    const setSourceVisibility = (sourceId: string, visible: boolean) => {
      setEventState('visibleSourceIds', (current) => {
        if (visible) {
          return current.includes(sourceId) ? current : [...current, sourceId];
        }

        return current.filter((id) => id !== sourceId);
      });

      if (!visible && selectedEvent()?.calendar.id === sourceId) {
        closeEventDetails();
      }
    };

    const selectEvent = (eventId: string, anchor: HTMLElement) => {
      setEventState('selectedEventId', eventId);
      setSelectedEventAnchor(anchor);
    };

    return {
      eventState,
      displaySettings,
      visibleRange,
      updateVisibleRange,
      occurrencesQuery,
      events,
      sources: () => CALENDAR_SOURCES,
      isSourceVisible: (sourceId: string) =>
        eventState.visibleSourceIds.includes(sourceId),
      setSourceVisibility,
      eventsById,
      selectedEvent,
      fullCalendarEvents,
      isLoading,
      isSyncing,
      selectedEventAnchor,
      useNarrowDayHeaders,
      setUseNarrowDayHeaders,
      setShowWeekends: (showWeekends: boolean) =>
        setDisplaySettings('showWeekends', showWeekends),
      setWeekStartsOn: (weekStartsOn: CalendarWeekStart) =>
        setDisplaySettings('weekStartsOn', weekStartsOn),
      setTimeFormat: (timeFormat: CalendarTimeFormat) =>
        setDisplaySettings('timeFormat', timeFormat),
      closeEventDetails,
      selectEvent,
    };
  });
