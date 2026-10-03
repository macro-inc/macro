import type { CalendarPeriodView } from '@app/features/calendar/types';
import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';
import { createCalendarRange } from './calendar-range';
import type { CalendarViewTarget } from './types';

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

/**
 * The focused event and the locator that pages the view to it. The locator
 * travels as local dates; the view rebuilds the day-bounded occurrence window
 * from them, so it can aim directly instead of resolving the event first.
 */
export const calendarSearch = {
  namespace: CALENDAR_SEARCH_NAMESPACE,
  schema: z.object({
    eventId: z.string(),
    occurrenceKey: z.string(),
    startDate: z.string(),
    endDate: z.string(),
  }),
  defaults: { eventId: '', occurrenceKey: '', startDate: '', endDate: '' },
};

export type CalendarSearchParams = z.infer<typeof calendarSearch.schema>;

export const calendarSearchCodec = createSearchParamsCodec(calendarSearch);

/** Search fields for a view target. */
export function calendarTargetSearch(
  target: CalendarViewTarget
): CalendarSearchParams {
  return {
    eventId: target.eventId ?? '',
    occurrenceKey: target.occurrenceKey ?? '',
    startDate: target.range?.startDate ?? '',
    endDate: target.range?.endDate ?? '',
  };
}

/** The view target a search carries. Dates that do not parse yield no range. */
export function calendarSearchTarget(
  search: CalendarSearchParams
): CalendarViewTarget {
  return {
    eventId: search.eventId || undefined,
    occurrenceKey: search.occurrenceKey || undefined,
    range: search.startDate
      ? createCalendarRange({
          kind: 'allDay',
          startDate: search.startDate,
          endDate: search.endDate || undefined,
        })
      : undefined,
  };
}
