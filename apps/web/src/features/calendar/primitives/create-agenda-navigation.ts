import { beginInteraction } from '@app/observability/flow';
import { addDays, startOfDay, startOfWeek } from 'date-fns';
import { type Accessor, createSignal } from 'solid-js';
import type { CalendarPeriodView, CalendarWeekStart } from '../types';
import { getCalendarSupportedRange } from '../utils/calendar-supported-range';
import { agendaWindow, clipAgendaWindow } from './agenda-window';

interface AgendaNavigationOptions {
  initialDate: Date;
  weekStartsOn: Accessor<CalendarWeekStart>;
  onNavigate: () => void;
  onDateChange: (date: Date) => void;
  onViewChange: (period: CalendarPeriodView) => void;
}

/** Agenda owns its selected day; only explicit actions transfer it to another host. */
export function createAgendaNavigation(options: AgendaNavigationOptions) {
  const [date, setDate] = createSignal(startOfDay(options.initialDate));
  const jump = (next: Date) => {
    const interaction = beginInteraction('calendar.agenda.navigate');
    try {
      options.onNavigate();
      const day = startOfDay(next);
      setDate(day);
      options.onDateChange(day);
    } finally {
      interaction.end();
    }
  };
  return {
    periodView: () => 'agenda' as const,
    activeDate: date,
    navigationDate: date,
    displayRange: () => ({ start: date(), end: addDays(date(), 7) }),
    weekRange: () => {
      const start = startOfWeek(date(), {
        weekStartsOn: options.weekStartsOn(),
      });
      return { start, end: addDays(start, 7) };
    },
    visibleRange: () =>
      clipAgendaWindow(agendaWindow(date(), 0), getCalendarSupportedRange()),
    gotoDate: jump,
    navigateToDate: jump,
    navigateToToday: () => jump(new Date()),
    previousPeriod: () => jump(addDays(date(), -7)),
    nextPeriod: () => jump(addDays(date(), 7)),
    changeView: (period: CalendarPeriodView) => {
      if (period === 'agenda') return;
      options.onNavigate();
      options.onDateChange(date());
      options.onViewChange(period);
    },
  };
}
