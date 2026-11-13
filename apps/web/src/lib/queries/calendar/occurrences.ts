import { throwOnErr } from '@core/util/result';
import type { CacheHost } from '@graphql-cache/index';
import { type Span, Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { subscribeToVisibleCacheChanges } from '@queries/subscribe-to-visible-cache-changes';
import { storageServiceClient } from '@service-storage/client';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { CalendarOccurrenceResponse } from '@service-storage/generated/schemas/calendarOccurrenceResponse';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import {
  hashKey,
  type Query,
  queryOptions,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import { type Accessor, createEffect, onCleanup } from 'solid-js';
import {
  type CalendarUpdate,
  calendarUpdateReadRevision,
  reconcileCalendarUpdateRead,
} from './event-updates';
import {
  answeringGraphqlCalendarHost,
  markCalendarCacheUnsupported,
  useGraphqlCalendarHost,
} from './graphql/flag';
import {
  readCalendarRange,
  retryUnreadableCalendarOccurrences,
} from './graphql/range';
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
  /** Real reads only; optimistic cache writes never count as completed refreshes. */
  onRefresh?: (phase: 'started' | 'completed') => void;
}

type CalendarOccurrencesQueryKey =
  | ReturnType<typeof calendarKeys.occurrences>['queryKey']
  | ReturnType<typeof calendarKeys.occurrences>['_ctx']['graphql']['queryKey'];

export interface CalendarOccurrencesData {
  items: CalendarOccurrenceItem[];
  syncStatus: CalendarOccurrenceResponse['syncStatus'];
  /** Some cache records remain unreadable; this is not a complete refresh. */
  partial?: boolean;
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
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const revision = calendarUpdateReadRevision(queryClient);
        if (!range) {
          throw new Error('Calendar occurrence range is unavailable');
        }
        const read = await readCalendarRange(host, range, { signal });
        if (read.kind === 'unsupported') markCalendarCacheUnsupported(host);
        const data =
          read.kind === 'range'
            ? read.data
            : await fetchCalendarOccurrences(range, signal);
        return reconcileCalendarUpdateRead(
          queryClient,
          keys._ctx.graphql.queryKey,
          data,
          revision,
          range
        );
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
    queryFn: async ({ signal }) => {
      const revision = calendarUpdateReadRevision(queryClient);
      if (!range) {
        throw new Error('Calendar occurrence range is unavailable');
      }

      const data = await fetchCalendarOccurrences(range, signal);
      return reconcileCalendarUpdateRead(
        queryClient,
        keys.queryKey,
        data,
        revision,
        range
      );
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
    const onRefresh = options?.().onRefresh;
    if (!onRefresh) return;
    const { userId, range } = input();
    const keys = calendarKeys.occurrences(userId ?? '', range);
    const queryKey = cacheHost() ? keys._ctx.graphql.queryKey : keys.queryKey;
    const queryHash = hashKey(queryKey);
    onCleanup(
      activeQueryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.query.queryHash !== queryHash)
          return;
        if (event.action.type === 'fetch') onRefresh('started');
        if (event.action.type === 'success' && !event.action.manual) {
          const data =
            activeQueryClient.getQueryData<CalendarOccurrencesData>(queryKey);
          if (data && !data.partial) onRefresh('completed');
        }
      })
    );
  });

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

/**
 * Refetches every mounted occurrence viewport. With calendar reads on the
 * cache, the delta runs first so the viewports see the change that prompted
 * the refresh rather than the cache from before it. A cache still starting
 * would hold the delta, so the viewports refetch without it. The refetch is
 * skipped when `stillCurrent` turns false while the delta runs.
 */
export async function invalidateCalendarOccurrences(
  stillCurrent: () => boolean = () => true
) {
  const controller = activeCalendarSyncController();
  if (controller?.answering()) {
    await controller.runDelta().catch((error) => {
      console.warn('Calendar delta sync failed', error);
    });
  }
  if (!stillCurrent()) return;
  return queryClient.invalidateQueries({
    queryKey: calendarKeys.occurrences._def,
  });
}

/** Drain older reads, then fetch once after the write and delta have settled. */
export async function refreshCalendarEventOccurrences(update: CalendarUpdate) {
  const { client } = update;
  const isCurrent = () => !update.state.retired && update.state.isCurrent();
  const operation = async (span: Span) => {
    span.setAttr('calendar.event_id', update.args.eventId);
    if (update.args.calendarId)
      span.setAttr('calendar.calendar_id', update.args.calendarId);
    const controller = activeCalendarSyncController();
    if (controller?.answering()) {
      await span.span('calendar.occurrences_delta_sync', async (deltaSpan) => {
        try {
          await controller.runDelta();
        } catch {
          deltaSpan.error('Calendar delta sync failed');
        }
      });
    }
    if (!isCurrent()) return;
    await client.invalidateQueries({
      queryKey: calendarKeys.occurrences._def,
      refetchType: 'none',
    });
    const refreshed = new Set<Query>();
    let failure: PromiseRejectedResult | undefined;
    // Navigation can mount another range while the first refresh is running.
    // Keep the same lock until all currently mounted ranges finish their reads.
    while (isCurrent()) {
      const queries = client
        .getQueryCache()
        .findAll({
          queryKey: calendarKeys.occurrences._def,
          type: 'active',
        })
        .filter(
          (query) => !refreshed.has(query) || query.state.fetchStatus !== 'idle'
        );
      if (queries.length === 0) break;
      const results = await Promise.allSettled(
        queries.map(async (query) => {
          // TanStack reuses an uncached in-flight fetch even with cancelRefetch.
          // Drain it first so only a newly started read can end this operation.
          if (query.state.fetchStatus !== 'idle') {
            await query
              .fetch(undefined, { cancelRefetch: false })
              .catch(() => {});
          }
          if (
            !isCurrent() ||
            !query.isActive() ||
            refreshed.has(query) ||
            client.getQueryCache().get(query.queryHash) !== query
          )
            return;
          refreshed.add(query);
          return query.fetch(undefined, { cancelRefetch: false });
        })
      );
      failure ??= results.find((result) => result.status === 'rejected');
    }
    span.setAttr('calendar.refresh.outcome', failure ? 'error' : 'finished');
    if (failure) throw failure.reason;
  };
  return update.args.parentSpan
    ? update.args.parentSpan.span('calendar.event_update_refresh', operation)
    : Telemetry.span('calendar.event_update_refresh', operation);
}

/**
 * Brings the calendar forward for a read that came back without something it
 * expected. Unlike `invalidateCalendarOccurrences`, the delta always runs,
 * waiting for a cache that is still starting: nothing awaits this refresh, and
 * a refetch that skipped the delta could reread a stale covered week.
 */
export async function syncCalendarOccurrences(
  options: { retryUnreadable?: boolean } = {}
) {
  const host = options.retryUnreadable
    ? answeringGraphqlCalendarHost()
    : undefined;
  if (host) retryUnreadableCalendarOccurrences(host);
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
