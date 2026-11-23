import { throwOnErr } from '@core/util/result';
import type { CacheHost } from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { subscribeToVisibleCacheChanges } from '@queries/subscribe-to-visible-cache-changes';
import { storageServiceClient } from '@service-storage/client';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { CalendarOccurrenceResponse } from '@service-storage/generated/schemas/calendarOccurrenceResponse';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/solid-query';
import { ResultAsync } from 'neverthrow';
import { type Accessor, createEffect, onCleanup } from 'solid-js';
import {
  markCalendarCacheUnsupported,
  useGraphqlCalendarHost,
} from './graphql/flag';
import {
  CALENDAR_CACHE_READ_DEADLINE_MS,
  calendarCacheAnswered,
  recordCalendarRestAnswer,
  withinDeadline,
} from './graphql/readiness';
import {
  activeCalendarSyncController,
  type CalendarSyncController,
} from './graphql/sync-controller';
import { readCalendarViewport } from './graphql/viewport';
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

/** A viewport read over REST while calendars do not read the cache. */
async function fetchRestViewport(
  range: CalendarOccurrenceQueryRange,
  signal: AbortSignal
): Promise<CalendarOccurrencesData> {
  const data = await fetchCalendarOccurrences(range, signal);
  // The cache taking over later seeds from this answer.
  recordCalendarRestAnswer();
  return data;
}

/**
 * Reads a viewport through the cache, from REST whenever the cache cannot
 * answer, and records which path answered on the calendar load's trace.
 */
async function readCachedCalendarOccurrences(
  host: CacheHost,
  range: CalendarOccurrenceQueryRange,
  signal: AbortSignal
): Promise<CalendarOccurrencesData> {
  return Telemetry.span(
    'calendar.occurrences.read',
    { sampling: 'perf' },
    async (span) => {
      const read = await ResultAsync.fromPromise(
        readCalendarViewport(host, range, {
          fetchRest: fetchCalendarOccurrences,
          span,
          signal,
          sync: activeCalendarSyncController(),
        }),
        (error) => error
      );
      if (read.isErr()) {
        if (!signal.aborted) span.error(read.error);
        throw read.error;
      }
      if (read.value.source === 'rest') {
        recordCalendarRestAnswer();
        if (read.value.fallback === 'unsupported')
          markCalendarCacheUnsupported(host);
      }
      return read.value.data;
    }
  );
}

// Cached callbacks close over the resolved host, range and flags only.
function calendarOccurrencesQueryOptions(
  host: CacheHost | undefined,
  userId: string | undefined,
  range: CalendarOccurrenceQueryRange | undefined,
  enabled: boolean,
  pollWhileSyncing: boolean,
  refetchOnWindowFocus: boolean
) {
  const keys = calendarKeys.occurrences(userId ?? '', range);
  // Even the otherwise infinitely fresh GraphQL query must run once after
  // being seeded. A successful read restores its normal freshness policy.
  const staleTime = (query: { state: { dataUpdatedAt: number } }) =>
    query.state.dataUpdatedAt === 0 ? 0 : host ? Infinity : CALENDAR_STALE_TIME;

  if (host) {
    return queryOptions<
      CalendarOccurrencesData,
      Error,
      CalendarOccurrencesData,
      CalendarOccurrencesQueryKey
    >({
      queryKey: keys._ctx.graphql.queryKey,
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        if (!range) {
          throw new Error('Calendar occurrence range is unavailable');
        }
        return readCachedCalendarOccurrences(host, range, signal);
      },
      enabled,
      staleTime,
      // Covered viewports never touch the network, so offline reads run.
      networkMode: 'offlineFirst' as const,
      refetchOnWindowFocus: false,
      // Read from REST while the cache was starting: poll like the REST
      // path until the provider sync finishes.
      refetchInterval: (query: {
        state: { data: CalendarOccurrencesData | undefined };
      }) =>
        pollWhileSyncing &&
        !calendarCacheAnswered(host) &&
        query.state.data?.syncStatus === CalendarSyncStatus.syncing
          ? CALENDAR_SYNC_POLL_INTERVAL
          : false,
    });
  }

  return queryOptions<
    CalendarOccurrencesData,
    Error,
    CalendarOccurrencesData,
    CalendarOccurrencesQueryKey
  >({
    queryKey: keys.queryKey,
    queryFn: ({ signal }) => {
      if (!range) {
        throw new Error('Calendar occurrence range is unavailable');
      }

      return fetchRestViewport(range, signal);
    },
    enabled,
    staleTime,
    refetchOnWindowFocus,
    refetchInterval: (query) =>
      pollWhileSyncing &&
      query.state.data?.syncStatus === CalendarSyncStatus.syncing
        ? CALENDAR_SYNC_POLL_INTERVAL
        : false,
  });
}

/** Reuses only the current user's date range when the transport changes. */
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
      subscribeToVisibleCacheChanges(host, () => {
        // A read now would only reach REST again, which a change in the
        // cache cannot bring forward.
        if (activeCalendarSyncController()?.canCatchUp() === false) return;
        return activeQueryClient.invalidateQueries(
          { queryKey },
          { cancelRefetch: false }
        );
      })
    );
  });

  return useQuery<
    CalendarOccurrencesData,
    Error,
    CalendarOccurrencesData,
    CalendarOccurrencesQueryKey
  >(() => {
    const { userId, range } = input();
    const opts = options?.();
    const host = cacheHost();
    const keys = calendarKeys.occurrences(userId ?? '', range);
    // Seed the new transport's cache, rather than an observer-only placeholder,
    // so optimistic edits and rollbacks can update the visible events too.
    const queryKey = host ? keys._ctx.graphql.queryKey : keys.queryKey;
    if (activeQueryClient.getQueryData(queryKey) === undefined) {
      const previous = activeQueryClient.getQueryData<CalendarOccurrencesData>(
        host ? keys.queryKey : keys._ctx.graphql.queryKey
      );
      if (previous) {
        activeQueryClient.setQueryData(queryKey, previous, { updatedAt: 0 });
      }
    }

    return calendarOccurrencesQueryOptions(
      host,
      userId,
      range,
      Boolean(userId) && range !== undefined && opts?.enabled !== false,
      opts?.pollWhileSyncing !== false,
      opts?.refetchOnWindowFocus ?? true
    );
  });
}

async function runDeltaReportingFailure(
  controller: CalendarSyncController
): Promise<void> {
  const run = await ResultAsync.fromPromise(
    controller.runDelta(),
    (error) => error
  );
  if (run.isErr()) console.warn('Calendar delta sync failed', run.error);
}

/**
 * Refetches every mounted occurrence viewport. With calendar reads on the
 * cache, the delta runs first so the viewports see the change that prompted
 * the refresh rather than the cache from before it. A cache still starting
 * would hold the delta, so the viewports refetch without it, from REST; the
 * first read the cache answers afterwards runs the delta before it. A delta
 * that fails, or is still running at the read deadline (a cache waiting on
 * another tab), does not hold the refetch: the change is noticed, so reads
 * wait for the delta or go to REST instead of answering from the older
 * cache. The refetch is skipped when `stillCurrent` turns false while the
 * delta runs.
 */
export async function invalidateCalendarOccurrences(
  stillCurrent: () => boolean = () => true
) {
  const controller = activeCalendarSyncController();
  controller?.noticeChange();
  if (controller?.answering()) {
    await withinDeadline(
      runDeltaReportingFailure(controller),
      CALENDAR_CACHE_READ_DEADLINE_MS
    );
  }
  if (!stillCurrent()) return;
  return queryClient.invalidateQueries({
    queryKey: calendarKeys.occurrences._def,
  });
}

/**
 * Brings the calendar forward for a read that came back without something it
 * expected. Unlike `invalidateCalendarOccurrences`, the delta always runs,
 * waiting for a cache that is still starting: nothing awaits this refresh, and
 * a refetch that skipped the delta could reread a stale covered week.
 */
export async function syncCalendarOccurrences() {
  return Telemetry.span('calendar.occurrences_sync', async (parent) => {
    const controller = activeCalendarSyncController();
    await parent.span('calendar.occurrences_delta_sync', async (span) => {
      span.setAttr('calendar.transport', controller ? 'graphql' : 'rest');
      if (!controller) return;
      try {
        await controller.runDelta();
        span.setAttr('calendar.delta.outcome', 'synced');
      } catch (error) {
        span.setAttr('calendar.delta.outcome', 'failed');
        span.error('Calendar delta sync failed');
        console.warn('Calendar delta sync failed', error);
      }
    });
    return parent.span('calendar.occurrences_refetch', () =>
      queryClient.invalidateQueries({
        queryKey: calendarKeys.occurrences._def,
      })
    );
  });
}
