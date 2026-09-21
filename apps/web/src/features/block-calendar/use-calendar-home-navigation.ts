import { useSearchParams } from '@solidjs/router';
import type { CalendarHomeTab } from '../calendar-home/core/calendar-home';

/** URL state preserves calendar destinations through reloads and browser history. */
export function useCalendarHomeNavigation(callsEnabled: boolean) {
  const [params, setParams] = useSearchParams();
  return {
    tab: (): CalendarHomeTab =>
      callsEnabled && params.calendarView === 'calls' ? 'calls' : 'events',
    navigateView: (view: CalendarHomeTab) => {
      if (params.calendarView === view) return;
      setParams({ calendarView: view }, { replace: false, scroll: false });
    },
  };
}
