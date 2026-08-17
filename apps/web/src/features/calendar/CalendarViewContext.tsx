import { createAssertedContextProvider } from '@core/context/createContext';
import { isMobile } from '@core/mobile/isMobile';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import { makePersisted } from '@solid-primitives/storage';
import { batch, createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { calendarDisplayLabel, spansMultipleInboxes } from './calendar-label';
import { DEFAULT_CALENDAR_SOURCE } from './events/calendar-occurrence-mapper';
import type {
  CalendarEvent,
  CalendarPeriodView,
  CalendarSource,
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
    const calendarsQuery = useVisibleCalendarsQuery();
    const sources = createMemo<CalendarSource[]>(() => {
      const calendars = calendarsQuery.data;
      if (!calendars || calendars.length === 0) {
        return [DEFAULT_CALENDAR_SOURCE];
      }
      const spansInboxes = spansMultipleInboxes(calendars);
      return calendars.map((calendar) => ({
        id: calendar.id,
        name: calendarDisplayLabel(calendar, spansInboxes),
        color: calendar.color ?? DEFAULT_CALENDAR_SOURCE.color,
      }));
    });
    const sourceById = createMemo(
      () => new Map(sources().map((source) => [source.id, source]))
    );
    // Sources default to visible, so calendars discovered after a
    // preference was saved (or events whose calendar is still loading)
    // never silently disappear.
    const isSourceVisible = (sourceId: string) =>
      !preferences.hiddenSourceIds.includes(sourceId);

    const [selectedEventId, setSelectedEventId] = createSignal<string>();
    const eventState: CalendarEventState = {
      get visibleSourceIds() {
        return sources()
          .filter((source) => isSourceVisible(source.id))
          .map((source) => source.id);
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
      sources,
      sourceById,
      isSourceVisible,
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
