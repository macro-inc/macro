import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { calendarKeys } from './keys';

export type { VisibleCalendar } from '@service-email/generated/schemas/visibleCalendar';

const CALENDAR_LIST_STALE_TIME = 5 * 60_000;

/**
 * Calendars visible to the viewer across connected and delegated inboxes,
 * primaries and writable calendars first — the order pickers present them in.
 */
export function useVisibleCalendarsQuery(
  options?: Accessor<{ enabled?: boolean }>
) {
  return useQuery(() => ({
    queryKey: calendarKeys.visibleCalendars.queryKey,
    queryFn: async () =>
      (await throwOnErr(() => emailClient.listCalendars())).calendars,
    staleTime: CALENDAR_LIST_STALE_TIME,
    enabled: options?.().enabled !== false,
  }));
}
