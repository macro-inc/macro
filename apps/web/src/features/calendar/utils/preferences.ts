import { isMobile } from '@core/mobile/isMobile';
import { createSharedRoot } from '@solid-primitives/rootless';
import { makePersisted } from '@solid-primitives/storage';
import { createStore } from 'solid-js/store';
import type {
  CalendarPeriodView,
  CalendarTimeFormat,
  CalendarWeekStart,
} from '../types';
import { getDefaultCalendarTimeFormat } from './time-format';

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

export const useCalendarPreferences = createSharedRoot(() => {
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
  return [preferences, setPreferences] as const;
});
