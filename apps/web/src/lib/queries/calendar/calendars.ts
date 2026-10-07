import { throwOnErr } from '@core/util/result';
import type { CacheHost } from '@graphql-cache/index';
import { subscribeToVisibleCacheChanges } from '@queries/subscribe-to-visible-cache-changes';
import type { VisibleCalendar } from '@service-calendar/generated/schemas/visibleCalendar';
import { emailClient } from '@service-email/client';
import { CalendarsDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { useQuery, useQueryClient } from '@tanstack/solid-query';
import { type Accessor, createEffect, onCleanup } from 'solid-js';
import { useGraphqlCalendarHost } from './graphql/flag';
import { mapVisibleCalendar } from './graphql/map';
import {
  calendarCacheAnswered,
  withinCacheHeadStart,
} from './graphql/readiness';
import { calendarKeys } from './keys';

export type { VisibleCalendar };

const CALENDAR_LIST_STALE_TIME = 5 * 60_000;

/**
 * Calendars visible to the viewer across connected and delegated inboxes,
 * primaries and writable calendars first — the order pickers present them in.
 */
export function useVisibleCalendarsQuery(
  options?: Accessor<{ enabled?: boolean }>
) {
  const cacheHost = useGraphqlCalendarHost();
  const activeQueryClient = useQueryClient();

  createEffect(() => {
    const host = cacheHost();
    if (!host) return;
    onCleanup(
      subscribeToVisibleCacheChanges(host, () =>
        activeQueryClient.invalidateQueries(
          { queryKey: calendarKeys.visibleCalendars._ctx.graphql.queryKey },
          { cancelRefetch: false }
        )
      )
    );
  });

  return useQuery<
    VisibleCalendar[],
    Error,
    VisibleCalendar[],
    | typeof calendarKeys.visibleCalendars.queryKey
    | typeof calendarKeys.visibleCalendars._ctx.graphql.queryKey
  >(() => {
    const host = cacheHost();
    if (host) {
      return {
        queryKey: calendarKeys.visibleCalendars._ctx.graphql.queryKey,
        queryFn: () => readCalendarList(host),
        staleTime: Infinity,
        networkMode: 'offlineFirst' as const,
        enabled: options?.().enabled !== false,
      };
    }
    return {
      queryKey: calendarKeys.visibleCalendars.queryKey,
      queryFn: listCalendars,
      staleTime: CALENDAR_LIST_STALE_TIME,
      enabled: options?.().enabled !== false,
    };
  });
}

async function listCalendars() {
  return (await throwOnErr(() => emailClient.listCalendars())).calendars;
}

/**
 * Reads the list from the cache. A cache that has not answered a calendar read
 * gets a head start; past it, or if its read fails, the list comes from REST.
 */
async function readCalendarList(host: CacheHost) {
  if (calendarCacheAnswered(host)) return readCachedCalendars();
  const cached = await withinCacheHeadStart(
    (async () => {
      try {
        return await readCachedCalendars();
      } catch {
        return 'not-ready' as const;
      }
    })()
  );
  return cached === 'not-ready' ? listCalendars() : cached;
}

/** Reads the calendar list from the cache, fetching it once when absent. */
async function readCachedCalendars() {
  const result = await getGraphqlSoupClient()
    .query(CalendarsDocument, {}, { requestPolicy: 'cache-first' })
    .toPromise();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Calendars returned no data');
  return result.data.user.calendars.map(mapVisibleCalendar);
}
