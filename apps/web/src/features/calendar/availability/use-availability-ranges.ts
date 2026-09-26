import { useUserId } from '@core/context/user';
import { calendarKeys } from '@queries/calendar/keys';
import {
  createCalendarOccurrenceQueryRange,
  fetchCalendarOccurrences,
  useCalendarOccurrencesQuery,
} from '@queries/calendar/occurrences';
import { queryClient } from '@queries/client';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import {
  AVAILABILITY_RANGE_OPTIONS,
  type AvailabilityDay,
  type AvailabilityRangeKey,
  type AvailabilitySettings,
  busyIntervalsFromOccurrences,
  computeAvailability,
  resolveAvailabilityWindow,
} from './availability';

/** Evaluates every copy range against the same occurrence snapshot and settings. */
export function useAvailabilityRanges(settings: () => AvailabilitySettings) {
  const userId = useUserId();
  const [now, setNow] = createSignal(new Date());
  const query = useCalendarOccurrencesQuery(() => {
    const window = resolveAvailabilityWindow('next14Days', now());
    return {
      userId: userId(),
      range: createCalendarOccurrenceQueryRange(
        window.start,
        window.endExclusive
      ),
    };
  });

  // Keep the remaining portion of today current while the dialog is open.
  // The query key changes at local midnight to cover the new last day.
  onMount(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    onCleanup(() => clearInterval(timer));
  });

  const days = createMemo(() => {
    const data =
      query.isSuccess && !query.isPlaceholderData ? query.data : undefined;
    if (!data || data.syncStatus === CalendarSyncStatus.syncing) return;

    const busyIntervals = busyIntervalsFromOccurrences(data.items);
    const currentSettings = settings();
    const currentTime = now();
    return Object.fromEntries(
      AVAILABILITY_RANGE_OPTIONS.map(({ key }) => [
        key,
        computeAvailability({
          rangeKey: key,
          settings: currentSettings,
          busyIntervals,
          now: currentTime,
        }),
      ])
    ) as Record<AvailabilityRangeKey, AvailabilityDay[]>;
  });

  const refreshRange = async (rangeKey: AvailabilityRangeKey) => {
    const window = resolveAvailabilityWindow('next14Days', new Date());
    const range = createCalendarOccurrenceQueryRange(
      window.start,
      window.endExclusive
    );
    // A copy must use current occurrences, even when the initial query's
    // 60-second cache window has not expired yet.
    const data = await queryClient.fetchQuery({
      queryKey: calendarKeys.occurrences(userId() ?? '', range).queryKey,
      queryFn: ({ signal }) => fetchCalendarOccurrences(range, signal),
      staleTime: 0,
    });
    if (data.syncStatus === CalendarSyncStatus.syncing) return;

    const currentTime = new Date();
    return {
      days: computeAvailability({
        rangeKey,
        settings: settings(),
        busyIntervals: busyIntervalsFromOccurrences(data.items),
        now: currentTime,
      }),
      now: currentTime,
    };
  };
  return {
    days,
    refreshRange,
    isError: () => query.isError,
    retry: () => void query.refetch(),
  };
}
