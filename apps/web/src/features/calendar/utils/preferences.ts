import { createSharedRoot } from '@solid-primitives/rootless';
import { makePersisted } from '@solid-primitives/storage';
import { createStore } from 'solid-js/store';
import {
  CALENDAR_PREFERENCES_KEY,
  getPreferredCalendarPeriodView,
} from '../calendar-preferences';
import type {
  CalendarPeriodView,
  CalendarTimeFormat,
  CalendarWeekStart,
} from '../types';
import { getDefaultCalendarTimeFormat } from './time-format';

interface CalendarPreferences {
  periodView: CalendarPeriodView;
  hiddenSourceIds: string[];
  sourceColors: Record<string, string | undefined>;
  accountColors: Record<string, string | undefined>;
  showWeekends: boolean;
  weekStartsOn: CalendarWeekStart;
  timeFormat: CalendarTimeFormat;
}

/** One persisted store, so preference changes reach invitation cards outside the calendar. */
export const useCalendarPreferences = createSharedRoot(() => {
  const defaultPreferences: CalendarPreferences = {
    periodView: getPreferredCalendarPeriodView(),
    hiddenSourceIds: [],
    sourceColors: {},
    accountColors: {},
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
