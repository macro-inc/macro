import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { subscribeToVisibleCacheChanges } from '@queries/subscribe-to-visible-cache-changes';
import { storageServiceClient } from '@service-storage/client';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { CalendarOccurrenceResponse } from '@service-storage/generated/schemas/calendarOccurrenceResponse';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import {
  hashKey,
  type PlaceholderDataFunction,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import { type Accessor, createEffect, onCleanup } from 'solid-js';
import {
  markCalendarCacheUnsupported,
  useGraphqlCalendarHost,
} from './graphql/flag';
import { readCalendarRange } from './graphql/range';
import { calendarCacheAnswered } from './graphql/readiness';
import { activeCalendarSyncController } from './graphql/sync-controller';
import { type CalendarOccurrenceQueryRange, calendarKeys } from './keys';

export type { CalendarOccurrenceQueryRange } from './keys';

const CALENDAR_OCCURRENCE_PAGE_SIZE = 2000;
const CALENDAR_SYNC_POLL_INTERVAL = 5000;
const CALENDAR_STALE_TIME = 60_000;

export interface CalendarOccurrencesQueryInput {
  userId: string | undefined;
  range: CalendarOccurrenceQueryRange | undefined;
}

export interface CalendarOccurrencesQueryOptions {
  enabled?: boolean;
  pollWhileSyncing?: boolean;
  refetchOnWindowFocus?: boolean;
}

type CalendarOccurrencesQueryKey =
  | ReturnType<typeof calendarKeys.occurrences>['queryKey']
  | ReturnType<typeof calendarKeys.occurrences>['_ctx']['graphql']['queryKey'];

export interface CalendarOccurrencesData {
  items: CalendarOccurrenceItem[];
  syncStatus: CalendarOccurrenceResponse['syncStatus'];
}

const formatLocalDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Creates the UTC and local boundaries required by the occurrence endpoint. */
export function createCalendarOccurrenceQueryRange(
  start: Date,
  end: Date
): CalendarOccurrenceQueryRange {
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(end),
  };
}

const occurrenceIdentity = (item: CalendarOccurrenceItem) =>
  JSON.stringify([item.event.id, item.occurrence.occurrenceKey]);

/** Fetches and deduplicates every occurrence page for one viewport. */
export async function fetchCalendarOccurrences(
  range: CalendarOccurrenceQueryRange,
  signal?: AbortSignal
): Promise<CalendarOccurrencesData> {
  const itemsById = new Map<string, CalendarOccurrenceItem>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let syncStatus: CalendarOccurrenceResponse['syncStatus'] =
    CalendarSyncStatus.ready;

  do {
    const page = await throwOnErr(() =>
      storageServiceClient.listCalendarOccurrences({
        ...range,
        cursor,
        limit: CALENDAR_OCCURRENCE_PAGE_SIZE,
        signal,
      })
    );

    if (page.syncStatus === CalendarSyncStatus.syncing) {
      syncStatus = CalendarSyncStatus.syncing;
    }

    for (const item of page.items) {
      itemsById.set(occurrenceIdentity(item), item);
    }

    if (!page.hasMore) break;

    const nextCursor = page.nextCursor ?? undefined;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error(
        'Calendar occurrence pagination returned an invalid cursor'
      );
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  return {
    items: [...itemsById.values()],
    syncStatus,
  };
}

/** Retained placeholders always belong to the current user and date range. */
export function useCalendarOccurrencesQuery(
  input: Accessor<CalendarOccurrencesQueryInput>,
  options?: Accessor<CalendarOccurrencesQueryOptions>
) {
  const cacheHost = useGraphqlCalendarHost();
  const activeQueryClient = useQueryClient();

  createEffect(() => {
    const host = cacheHost();
    if (!host) return;
    const { userId, range } = input();
    const queryKey = calendarKeys.occurrences(userId ?? '', range)._ctx.graphql
      .queryKey;
    onCleanup(
      subscribeToVisibleCacheChanges(host, () =>
        activeQueryClient.invalidateQueries(
          { queryKey },
          { cancelRefetch: false }
        )
      )
    );
  });

  return useQuery<
    CalendarOccurrencesData,
    Error,
    CalendarOccurrencesData,
    CalendarOccurrencesQueryKey
  >(() => {
    const { userId, range } = input();
    const enabled =
      Boolean(userId) && range !== undefined && options?.().enabled !== false;
    const host = cacheHost();
    const keys = calendarKeys.occurrences(userId ?? '', range);
    // A transport change still describes the same viewport. Retain those
    // events while its new reader starts, but never another user's or date's.
    const placeholderData: PlaceholderDataFunction<
      CalendarOccurrencesData,
      Error,
      CalendarOccurrencesData,
      CalendarOccurrencesQueryKey
    > = (previous, query) => {
      if (!query) return undefined;
      const previousKey = hashKey(query.queryKey);
      return previousKey === hashKey(keys.queryKey) ||
        previousKey === hashKey(keys._ctx.graphql.queryKey)
        ? previous
        : undefined;
    };

    if (host) {
      return {
        queryKey: keys._ctx.graphql.queryKey,
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          if (!range) {
            throw new Error('Calendar occurrence range is unavailable');
          }
          const read = await readCalendarRange(host, range, { signal });
          if (read.kind === 'range') return read.data;
          if (read.kind === 'unsupported') markCalendarCacheUnsupported(host);
          return fetchCalendarOccurrences(range, signal);
        },
        enabled,
        staleTime: Infinity,
        // Covered viewports never touch the network, so offline reads run.
        networkMode: 'offlineFirst' as const,
        placeholderData,
        refetchOnWindowFocus: false,
        // Read from REST while the cache was starting: poll like the REST
        // path until the provider sync finishes.
        refetchInterval: (query: {
          state: { data: CalendarOccurrencesData | undefined };
        }) =>
          options?.().pollWhileSyncing !== false &&
          !calendarCacheAnswered(host) &&
          query.state.data?.syncStatus === CalendarSyncStatus.syncing
            ? CALENDAR_SYNC_POLL_INTERVAL
            : false,
      };
    }

    return {
      queryKey: keys.queryKey,
      queryFn: ({ signal }) => {
        if (!range) {
          throw new Error('Calendar occurrence range is unavailable');
        }

        return fetchCalendarOccurrences(range, signal);
      },
      enabled:
        Boolean(userId) && range !== undefined && options?.().enabled !== false,
      staleTime: CALENDAR_STALE_TIME,
      placeholderData,
      refetchOnWindowFocus: options?.().refetchOnWindowFocus ?? true,
      refetchInterval: (query) =>
        options?.().pollWhileSyncing !== false &&
        query.state.data?.syncStatus === CalendarSyncStatus.syncing
          ? CALENDAR_SYNC_POLL_INTERVAL
          : false,
    };
  });
}

/**
 * Refetches every mounted occurrence viewport. With calendar reads on the
 * cache, the delta runs first so the viewports see the change that prompted
 * the refresh rather than the cache from before it. A cache still starting
 * would hold the delta, so the viewports refetch without it.
 */
export async function invalidateCalendarOccurrences() {
  const controller = activeCalendarSyncController();
  if (controller?.answering()) {
    await controller.runDelta().catch((error) => {
      console.warn('Calendar delta sync failed', error);
    });
  }
  return queryClient.invalidateQueries({
    queryKey: calendarKeys.occurrences._def,
  });
}
