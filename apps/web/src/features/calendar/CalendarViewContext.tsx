import { createAssertedContextProvider } from '@core/context/createContext';
import { batch, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { DEFAULT_CALENDAR_SOURCE } from './events/calendar-occurrence-mapper';
import type {
  CalendarEvent,
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

const CALENDAR_SOURCES = [DEFAULT_CALENDAR_SOURCE];

export const [CalendarViewContextProvider, useCalendarView] =
  createAssertedContextProvider('CalendarViewContext', () => {
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

    const [selectedEvent, setSelectedEvent] = createSignal<CalendarEvent>();
    const [selectedEventAnchor, setSelectedEventAnchor] =
      createSignal<HTMLElement>();
    const [useNarrowDayHeaders, setUseNarrowDayHeaders] = createSignal(false);

    const closeEventDetails = () => {
      batch(() => {
        setEventState('selectedEventId', undefined);
        setSelectedEvent(undefined);
        setSelectedEventAnchor(undefined);
      });
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

    const selectEvent = (event: CalendarEvent, anchor: HTMLElement) => {
      batch(() => {
        setEventState('selectedEventId', event.id);
        setSelectedEvent(() => event);
        setSelectedEventAnchor(anchor);
      });
    };

    const refreshSelectedEvent = (event: CalendarEvent) => {
      if (eventState.selectedEventId !== event.id) return;
      setSelectedEvent(event);
    };

    return {
      eventState,
      displaySettings,
      sources: () => CALENDAR_SOURCES,
      isSourceVisible: (sourceId: string) =>
        eventState.visibleSourceIds.includes(sourceId),
      setSourceVisibility,
      selectedEvent,
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
      refreshSelectedEvent,
    };
  });
