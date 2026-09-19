/**
 * Bridges the availability domain logic to calendar occurrence data. Shares
 * the calendar's occurrence query cache, so repeat copies are instant and a
 * freshly viewed range never refetches.
 */

import { useUserId } from '@core/context/user';
import { calendarKeys } from '@queries/calendar/keys';
import {
  createCalendarOccurrenceQueryRange,
  fetchCalendarOccurrences,
} from '@queries/calendar/occurrences';
import { queryClient } from '@queries/client';
import {
  type AvailabilityRangeKey,
  busyIntervalsFromOccurrences,
  computeAvailability,
  formatAvailabilityText,
  resolveAvailabilityWindow,
} from './availability';
import {
  getPersistedCalendarTimeFormat,
  useAvailabilitySettings,
} from './settings';

const AVAILABILITY_STALE_TIME = 60_000;

/**
 * Returns an async provider mapping a share range to formatted availability
 * text, or `undefined` when the range holds no free time.
 */
export function useAvailabilityText() {
  const userId = useUserId();
  const { settings } = useAvailabilitySettings();

  return async (
    rangeKey: AvailabilityRangeKey
  ): Promise<string | undefined> => {
    const now = new Date();
    const window = resolveAvailabilityWindow(rangeKey, now);
    const range = createCalendarOccurrenceQueryRange(
      window.start,
      window.endExclusive
    );
    const data = await queryClient.fetchQuery({
      queryKey: calendarKeys.occurrences(userId() ?? '', range).queryKey,
      queryFn: ({ signal }) => fetchCalendarOccurrences(range, signal),
      staleTime: AVAILABILITY_STALE_TIME,
    });

    const days = computeAvailability({
      rangeKey,
      settings: settings(),
      busyIntervals: busyIntervalsFromOccurrences(data.items),
      now,
    });
    if (days.length === 0) return undefined;
    return formatAvailabilityText(days, getPersistedCalendarTimeFormat(), now);
  };
}
