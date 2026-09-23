import type { CalendarPeriodView } from '@app/features/calendar/types';
import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';

export const CALENDAR_ROUTE_ID = 'view-calendar';
export const CALENDAR_SEARCH_NAMESPACE = 'calendar';

const CALENDAR_PERIOD_PATHS = {
  dayGridMonth: 'month',
  timeGridWeek: 'week',
  timeGridDay: 'day',
} as const satisfies Record<CalendarPeriodView, string>;

export const calendarPeriodParams = z.object({
  period: z
    .enum(['month', 'week', 'day'])
    .transform((period): CalendarPeriodView => {
      if (period === 'month') return 'dayGridMonth';
      if (period === 'day') return 'timeGridDay';
      return 'timeGridWeek';
    }),
});

export function calendarPeriodPath(period: CalendarPeriodView): string {
  return CALENDAR_PERIOD_PATHS[period];
}

export function calendarPath(period: CalendarPeriodView): string {
  return `/calendar/${calendarPeriodPath(period)}`;
}

export function calendarFocusedEventSearchKey(splitIndex = 0): string {
  return `s${splitIndex}.${CALENDAR_SEARCH_NAMESPACE}.eventId`;
}

export const calendarSearch = {
  namespace: CALENDAR_SEARCH_NAMESPACE,
  schema: z.object({ eventId: z.string() }),
  defaults: { eventId: '' },
};

export const calendarSearchCodec = createSearchParamsCodec(calendarSearch);
