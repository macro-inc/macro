import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { calendarKeys } from './keys';

export type { VisibleCalendar } from '@service-calendar/generated/schemas/visibleCalendar';

const CALENDAR_LIST_STALE_TIME = 5 * 60_000;

/**
 * Calendars visible to the viewer across connected and delegated inboxes,
 * primaries and writable calendars first — the order pickers present them in.
 */
export function useVisibleCalendarsQuery(
  options?: Accessor<{ enabled?: boolean }>
) {
  return useQuery(() =>
    visibleCalendarsQueryOptions(options?.().enabled !== false)
  );
}

async function fetchVisibleCalendars() {
  return (await throwOnErr(() => emailClient.listCalendars())).calendars;
}

function visibleCalendarsQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: calendarKeys.visibleCalendars.queryKey,
    queryFn: fetchVisibleCalendars,
    staleTime: CALENDAR_LIST_STALE_TIME,
    enabled,
  });
}
