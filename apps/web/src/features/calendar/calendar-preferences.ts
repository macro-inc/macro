import { isMobile } from '@core/mobile/isMobile';
import type { CalendarPeriodView } from './types';

/** Storage key shared by the calendar view and consumers of its preferences. */
export const CALENDAR_PREFERENCES_KEY = 'macro:pref:calendar:settings';

function isCalendarPeriodView(value: unknown): value is CalendarPeriodView {
  return (
    value === 'dayGridMonth' ||
    value === 'timeGridWeek' ||
    value === 'timeGridDay'
  );
}

/** The period a navigation without explicit route state should open. */
export function getPreferredCalendarPeriodView(): CalendarPeriodView {
  try {
    const raw = localStorage.getItem(CALENDAR_PREFERENCES_KEY);
    if (raw) {
      const periodView = (JSON.parse(raw) as { periodView?: unknown })
        .periodView;
      if (isCalendarPeriodView(periodView)) return periodView;
    }
  } catch {
    // Unreadable storage falls through to the device default.
  }
  return isMobile() ? 'timeGridDay' : 'timeGridWeek';
}
