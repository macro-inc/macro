import type { CalendarPeriodView } from '../types';

export const CALENDAR_PERIODS = [
  'timeGridDay',
  'timeGridWeek',
  'dayGridMonth',
  'agenda',
] as const satisfies readonly CalendarPeriodView[];
