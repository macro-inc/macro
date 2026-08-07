import { createAssertedContextProvider } from '@core/context/createContext';
import { isMobile } from '@core/mobile/isMobile';
import { makePersisted } from '@solid-primitives/storage';
import { batch, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { DEFAULT_CALENDAR_SOURCE } from './events/calendar-occurrence-mapper';
import type {
  CalendarEvent,
  CalendarPeriodView,
  CalendarTimeFormat,
  CalendarWeekStart,
} from './events/types';
import { getDefaultCalendarTimeFormat } from './time-format';

interface CalendarEventState {
  readonly visibleSourceIds: string[];
  readonly selectedEventId: string | undefined;
}

interface CalendarDisplaySettings {
  readonly periodView: CalendarPeriodView;
  readonly showWeekends: boolean;
  readonly weekStartsOn: CalendarWeekStart;
  readonly timeFormat: CalendarTimeFormat;
}

interface CalendarPreferences {
  periodView: CalendarPeriodView;
  hiddenSourceIds: string[];
  showWeekends: boolean;
  weekStartsOn: CalendarWeekStart;
  timeFormat: CalendarTimeFormat;
}

const CALENDAR_PREFERENCES_KEY = 'macro:pref:calendar:settings';
const CALENDAR_SOURCES = [DEFAULT_CALENDAR_SOURCE];

export const [CalendarViewContextProvider, useCalendarView] =
  createAssertedContextProvider('CalendarViewContext', () => {
    const defaultPreferences: CalendarPreferences = {
      periodView: isMobile() ? 'timeGridDay' : 'timeGridWeek',
      hiddenSourceIds: [],
      showWeekends: true,
      weekStartsOn: 0,
      timeFormat: getDefaultCalendarTimeFormat(),
    };
    const [preferences, setPreferences] = makePersisted(
      createStore<CalendarPreferences>(defaultPreferences),
      {
        name: CALENDAR_PREFERENCES_KEY,
        deserialize: (value) => ({
          ...defaultPreferences,
          ...(JSON.parse(value) as Partial<CalendarPreferences>),
        }),
      }
    );
    const [selectedEventId, setSelectedEventId] = createSignal<string>();
    const eventState: CalendarEventState = {
      get visibleSourceIds() {
        const hiddenSourceIds = preferences.hiddenSourceIds;
        return CALENDAR_SOURCES.filter(
          (source) => !hiddenSourceIds.includes(source.id)
        ).map((source) => source.id);
      },
      get selectedEventId() {
        return selectedEventId();
      },
    };
    const displaySettings: CalendarDisplaySettings = {
      get periodView() {
        return preferences.periodView;
      },
      get showWeekends() {
        return preferences.showWeekends;
      },
      get weekStartsOn() {
        return preferences.weekStartsOn;
      },
      get timeFormat() {
        return preferences.timeFormat;
      },
    };

    const [selectedEvent, setSelectedEvent] = createSignal<CalendarEvent>();
    const [selectedEventAnchor, setSelectedEventAnchor] =
      createSignal<HTMLElement>();
    const [useNarrowDayHeaders, setUseNarrowDayHeaders] = createSignal(false);

    const closeEventDetails = () => {
      batch(() => {
        setSelectedEventId(undefined);
        setSelectedEvent(undefined);
        setSelectedEventAnchor(undefined);
      });
    };

    const setSourceVisibility = (sourceId: string, visible: boolean) => {
      setPreferences('hiddenSourceIds', (current) =>
        visible
          ? current.filter((id) => id !== sourceId)
          : current.includes(sourceId)
            ? current
            : [...current, sourceId]
      );

      if (!visible && selectedEvent()?.calendar.id === sourceId) {
        closeEventDetails();
      }
    };

    const selectEvent = (event: CalendarEvent, anchor: HTMLElement) => {
      batch(() => {
        setSelectedEventId(event.id);
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
      setPeriodView: (periodView: CalendarPeriodView) =>
        setPreferences('periodView', periodView),
      setShowWeekends: (showWeekends: boolean) =>
        setPreferences('showWeekends', showWeekends),
      setWeekStartsOn: (weekStartsOn: CalendarWeekStart) =>
        setPreferences('weekStartsOn', weekStartsOn),
      setTimeFormat: (timeFormat: CalendarTimeFormat) =>
        setPreferences('timeFormat', timeFormat),
      closeEventDetails,
      selectEvent,
      refreshSelectedEvent,
    };
  });
