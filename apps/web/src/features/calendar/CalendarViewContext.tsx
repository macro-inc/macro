import { createAssertedContextProvider } from '@core/context/createContext';
import type { EventDropArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { mapCalendarEventToFullCalendar } from './events/event-mapper';
import type {
  CalendarEvent,
  CalendarSource,
  CalendarTimeFormat,
  CalendarWeekStart,
} from './events/types';
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

export const [CalendarViewContextProvider, useCalendarView] =
  createAssertedContextProvider('CalendarViewContext', () => {
    const [eventData, setEventData] = createSignal<
      CalendarEvent[] | undefined
    >();

    const [eventState, setEventState] = createStore<CalendarEventState>({
      visibleSourceIds: [],
      selectedEventId: undefined,
    });

    const [displaySettings, setDisplaySettings] =
      createStore<CalendarDisplaySettings>({
        showWeekends: true,
        weekStartsOn: 0,
        timeFormat: getDefaultCalendarTimeFormat(),
      });

    const [sources, setSources] = createSignal<CalendarSource[]>([]);
    const [selectedEventAnchor, setSelectedEventAnchor] =
      createSignal<HTMLElement>();
    const [useNarrowDayHeaders, setUseNarrowDayHeaders] = createSignal(false);

    const events = createMemo(() => eventData() ?? []);
    const eventsById = createMemo(
      () => new Map(events().map((event) => [event.id, event]))
    );
    const selectedEvent = createMemo(() => {
      const eventId = eventState.selectedEventId;
      return eventId ? eventsById().get(eventId) : undefined;
    });
    const visibleEvents = createMemo(() =>
      events().filter((event) =>
        eventState.visibleSourceIds.includes(event.calendar.id)
      )
    );
    const fullCalendarEvents = createMemo(() =>
      visibleEvents().map(mapCalendarEventToFullCalendar)
    );

    const isSourceVisible = (sourceId: string) =>
      eventState.visibleSourceIds.includes(sourceId);

    const replaceEvents = (nextEvents: CalendarEvent[]) => {
      setEventData(nextEvents);

      const nextSources = new Map(
        sources().map((source) => [source.id, source])
      );

      for (const event of nextEvents) {
        nextSources.set(event.calendar.id, event.calendar);
      }

      replaceSources([...nextSources.values()]);

      if (
        eventState.selectedEventId &&
        !nextEvents.some((event) => event.id === eventState.selectedEventId)
      ) {
        setEventState('selectedEventId', undefined);
        setSelectedEventAnchor(undefined);
      }
    };

    const replaceSources = (nextSources: CalendarSource[]) => {
      const knownSourceIds = sources().map((source) => source.id);

      setSources(nextSources);
      setEventState('visibleSourceIds', (current) => {
        const next = [...current];

        for (const source of nextSources) {
          if (
            !knownSourceIds.includes(source.id) &&
            !next.includes(source.id)
          ) {
            next.push(source.id);
          }
        }

        return next;
      });
    };

    const closeEventDetails = () => {
      setEventState('selectedEventId', undefined);
      setSelectedEventAnchor(undefined);
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

    const updateEventDates = ({
      event,
      revert,
    }: EventDropArg | EventResizeDoneArg) => {
      if (!eventsById().has(event.id) || !event.startStr || !event.endStr) {
        revert();
        return;
      }

      closeEventDetails();
      setEventData((current) =>
        (current ?? []).map((calendarEvent) =>
          calendarEvent.id === event.id
            ? {
                ...calendarEvent,
                start: event.startStr,
                end: event.endStr,
                allDay: event.allDay,
              }
            : calendarEvent
        )
      );
    };

    const selectEvent = (eventId: string, anchor: HTMLElement) => {
      setEventState('selectedEventId', eventId);
      setSelectedEventAnchor(anchor);
    };

    return {
      eventData,
      eventState,
      displaySettings,
      events,
      sources,
      eventsById,
      selectedEvent,
      fullCalendarEvents,
      isSourceVisible,
      selectedEventAnchor,
      useNarrowDayHeaders,
      setUseNarrowDayHeaders,
      replaceEvents,
      replaceSources,
      setShowWeekends: (showWeekends: boolean) =>
        setDisplaySettings('showWeekends', showWeekends),
      setWeekStartsOn: (weekStartsOn: CalendarWeekStart) =>
        setDisplaySettings('weekStartsOn', weekStartsOn),
      setTimeFormat: (timeFormat: CalendarTimeFormat) =>
        setDisplaySettings('timeFormat', timeFormat),
      closeEventDetails,
      setSourceVisibility,
      updateEventDates,
      selectEvent,
    };
  });
