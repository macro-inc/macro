import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { CalendarOccurrenceResponse } from '@service-storage/generated/schemas/calendarOccurrenceResponse';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
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
}

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

export function useCalendarOccurrencesQuery(
  input: Accessor<CalendarOccurrencesQueryInput>,
  options?: Accessor<CalendarOccurrencesQueryOptions>
) {
  return useQuery(() => {
    const { userId, range } = input();

    return {
      queryKey: calendarKeys.occurrences(userId ?? '', range).queryKey,
      queryFn: ({ signal }) => {
        if (!range) {
          throw new Error('Calendar occurrence range is unavailable');
        }

        return fetchCalendarOccurrences(range, signal);
      },
      enabled:
        Boolean(userId) && range !== undefined && options?.().enabled !== false,
      staleTime: CALENDAR_STALE_TIME,
      placeholderData: (p) => p,
      refetchOnWindowFocus: true,
      refetchInterval: (query) =>
        query.state.data?.syncStatus === CalendarSyncStatus.syncing
          ? CALENDAR_SYNC_POLL_INTERVAL
          : false,
    };
  });
}

export function invalidateCalendarOccurrences() {
  return queryClient.invalidateQueries({
    queryKey: calendarKeys.occurrences._def,
  });
}
