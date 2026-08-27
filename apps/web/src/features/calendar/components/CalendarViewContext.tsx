import { createAssertedContextProvider } from '@core/context/createContext';
import { isMobile } from '@core/mobile/isMobile';
import { makePersisted } from '@solid-primitives/storage';
import { batch, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useCalendarSources } from '../hooks/use-calendar-sources';
import type {
  CalendarEvent,
  CalendarPeriodView,
  CalendarTimeFormat,
  CalendarWeekStart,
} from '../types';
import { getDefaultCalendarTimeFormat } from '../utils/time-format';

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

/** Storage key for calendar display preferences (also read at copy time by
 * the availability feature, which runs outside this context). */
export const CALENDAR_PREFERENCES_KEY = 'macro:pref:calendar:settings';

function createCalendarEventSelection() {
  const [event, setEvent] = createSignal<CalendarEvent>();
  const [anchor, setAnchor] = createSignal<HTMLElement>();

  const close = () => {
    batch(() => {
      setEvent(undefined);
      setAnchor(undefined);
    });
  };
  const select = (nextEvent: CalendarEvent, nextAnchor: HTMLElement) => {
    batch(() => {
      setEvent(() => nextEvent);
      setAnchor(nextAnchor);
    });
  };
  const refresh = (nextEvent: CalendarEvent) => {
    if (event()?.id === nextEvent.id) setEvent(nextEvent);
  };

  return { anchor, close, event, refresh, select };
}

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
