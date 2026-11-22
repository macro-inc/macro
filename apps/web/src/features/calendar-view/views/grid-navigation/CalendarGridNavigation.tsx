import { useCalendarPager } from '@app/features/calendar/components/CalendarPagerContext';
import {
  type CalendarNavigationContext,
  CalendarNavigationProvider,
} from '@app/features/calendar/context/calendar-navigation-context';
import { SnapPager } from '@ui/components/SnapPager';
import type { ParentProps } from 'solid-js';

/** Adapts the grid pager to workspace navigation without exposing its renderer. */
export function CalendarGridNavigation(
  props: ParentProps<{
    onAgendaSelect: (date: Date | undefined) => void;
  }>
) {
  const calendarPager = useCalendarPager();
  const navigation: CalendarNavigationContext = {
    periodView: calendarPager.periodView,
    activeDate: calendarPager.activeDate,
    navigationDate: calendarPager.navigationDate,
    displayRange: () => {
      const info = calendarPager.activeDateInfo();
      return info ? { start: info.start, end: info.end } : undefined;
    },
    weekRange: () => {
      const info = calendarPager.activeDateInfo();
      return info?.view.type === 'timeGridWeek'
        ? { start: info.start, end: info.end }
        : undefined;
    },
    visibleRange: () => {
      const range = calendarPager.visibleRange();
      return range
        ? { start: new Date(range.start), end: new Date(range.end) }
        : undefined;
    },
    gotoDate: calendarPager.gotoDate,
    navigateToDate: calendarPager.navigateToDate,
    navigateToToday: calendarPager.navigateToToday,
    previousPeriod: calendarPager.previousPeriod,
    nextPeriod: calendarPager.nextPeriod,
    changeView: (period) => {
      if (period === 'agenda') {
        props.onAgendaSelect(calendarPager.navigationDate());
        return;
      }
      calendarPager.changeView(period);
    },
  };

  return (
    <CalendarNavigationProvider value={navigation}>
      <SnapPager.Root controller={calendarPager.pager}>
        {props.children}
      </SnapPager.Root>
    </CalendarNavigationProvider>
  );
}
