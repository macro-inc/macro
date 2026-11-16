import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { CalendarNavigationProvider } from '@app/features/calendar/context/calendar-navigation-context';
import { createAgendaNavigation } from '@app/features/calendar/primitives/create-agenda-navigation';
import { createEffect, on, type ParentProps } from 'solid-js';
import { useCalendarFocus } from '../../calendar-focus-target';

/** Supplies the same navigation capabilities as the grid, without a grid instance. */
export function AgendaNavigation(
  props: ParentProps<{
    date: Date;
    onDateChange: (date: Date) => void;
  }>
) {
  const view = useCalendarView();
  const focus = useCalendarFocus();
  const navigation = createAgendaNavigation({
    initialDate: props.date,
    weekStartsOn: () => view.displaySettings.weekStartsOn,
    onNavigate: view.closeEventDetails,
    onDateChange: props.onDateChange,
    onViewChange: view.setPeriodView,
  });
  createEffect(
    on(focus.pendingTarget, (target) => {
      if (target) navigation.navigateToDate(target.date);
    })
  );
  return (
    <CalendarNavigationProvider value={navigation}>
      {props.children}
    </CalendarNavigationProvider>
  );
}
