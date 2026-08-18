import { createAssertedContextProvider } from '@core/context/createContext';
import { isMobile } from '@core/mobile/isMobile';
import { makePersisted } from '@solid-primitives/storage';
import { createStore } from 'solid-js/store';
import { useCalendarSources } from '../data/use-calendar-sources';
import { createCalendarEventSelection } from '../events/create-calendar-event-selection';
import type {
  CalendarPeriodView,
  CalendarTimeFormat,
  CalendarWeekStart,
} from '../events/types';
import { getDefaultCalendarTimeFormat } from '../utils/time-format';

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
    const { sources, sourceById } = useCalendarSources();
    // Sources default to visible, so calendars discovered after a
    // preference was saved (or events whose calendar is still loading)
    // never silently disappear.
    const isSourceVisible = (sourceId: string) =>
      !preferences.hiddenSourceIds.includes(sourceId);

    const selection = createCalendarEventSelection();
    const eventState: CalendarEventState = {
      get visibleSourceIds() {
        return sources()
          .filter((source) => isSourceVisible(source.id))
          .map((source) => source.id);
      },
      get selectedEventId() {
        return selection.event()?.id;
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

    const closeEventDetails = selection.close;

    const setSourceVisibility = (sourceId: string, visible: boolean) => {
      setPreferences('hiddenSourceIds', (current) =>
        visible
          ? current.filter((id) => id !== sourceId)
          : current.includes(sourceId)
            ? current
            : [...current, sourceId]
      );

      if (!visible && selection.event()?.calendar.id === sourceId) {
        closeEventDetails();
      }
    };

    return {
      eventState,
      displaySettings,
      sources,
      sourceById,
      isSourceVisible,
      setSourceVisibility,
      selectedEvent: selection.event,
      selectedEventAnchor: selection.anchor,
      setPeriodView: (periodView: CalendarPeriodView) =>
        setPreferences('periodView', periodView),
      setShowWeekends: (showWeekends: boolean) =>
        setPreferences('showWeekends', showWeekends),
      setWeekStartsOn: (weekStartsOn: CalendarWeekStart) =>
        setPreferences('weekStartsOn', weekStartsOn),
      setTimeFormat: (timeFormat: CalendarTimeFormat) =>
        setPreferences('timeFormat', timeFormat),
      closeEventDetails,
      selectEvent: selection.select,
      refreshSelectedEvent: selection.refresh,
    };
  });
