import { beginInteraction } from '@app/observability/flow';
import { startOfWeek } from 'date-fns';
import { type Accessor, createSignal } from 'solid-js';
import type { CalendarPeriodView, CalendarWeekStart } from '../types';
import { getCalendarSupportedRange } from '../utils/calendar-supported-range';
import {
  agendaDay,
  agendaShift,
  agendaWindow,
  clipAgendaWindow,
} from './agenda-window';

interface AgendaNavigationOptions {
  initialDate: Date;
  weekStartsOn: Accessor<CalendarWeekStart>;
  onNavigate: () => void;
  onDateChange: (date: Date) => void;
  onViewChange: (period: CalendarPeriodView) => void;
  now?: () => Date;
}

/** Agenda owns its selected day; only explicit actions transfer it to another host. */
export function createAgendaNavigation(options: AgendaNavigationOptions) {
  const [date, setDate] = createSignal(agendaDay(options.initialDate));
  const jump = (next: Date) => {
    const interaction = beginInteraction('calendar.agenda.navigate');
    try {
      options.onNavigate();
      const day = agendaDay(next);
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
    displayRange: () => ({ start: date(), end: agendaShift(date(), 7) }),
    weekRange: () => {
      const start = startOfWeek(date(), {
        weekStartsOn: options.weekStartsOn(),
      });
      return { start, end: agendaShift(start, 7) };
    },
    visibleRange: () =>
      clipAgendaWindow(
        agendaWindow(date(), 0),
        getCalendarSupportedRange(options.now?.())
      ),
    gotoDate: jump,
    navigateToDate: jump,
    navigateToToday: () => jump(options.now?.() ?? new Date()),
    previousPeriod: () => jump(agendaShift(date(), -7)),
    nextPeriod: () => jump(agendaShift(date(), 7)),
    changeView: (period: CalendarPeriodView) => {
      if (period === 'agenda') return;
      options.onNavigate();
      options.onDateChange(date());
      options.onViewChange(period);
    },
  };
}
