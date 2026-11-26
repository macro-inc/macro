import { useCalendarPager } from '@app/features/calendar/components/CalendarPagerContext';
import {
  clipCalendarDisplayRange,
  isCalendarRangeSupported,
} from '@app/features/calendar/utils/calendar-supported-range';
import { useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import {
  createCalendarOccurrenceQueryRange,
  useCalendarOccurrencesQuery,
} from '@queries/calendar/occurrences';
import { createMemo, For } from 'solid-js';

function CalendarRangePreload(props: { position: number }) {
  const pager = useCalendarPager();
  const userId = useUserId();
  const range = createMemo(
    () => {
      const planned = pager.preloadRange(props.position);
      const clipped =
        isMobile() && pager.periodView() === 'dayGridMonth'
          ? clipCalendarDisplayRange(planned.start, planned.end)
          : undefined;
      return createCalendarOccurrenceQueryRange(
        clipped?.start ?? planned.start,
        clipped?.end ?? planned.end
      );
    },
    undefined,
    {
      equals: (previous, next) =>
        previous.start === next.start &&
        previous.end === next.end &&
        previous.startDate === next.startDate &&
        previous.endDate === next.endDate,
    }
  );
  // The ordinary observer shares cache keys and in-flight requests with Page.
  // Removing a far-behind observer aborts only reads without another consumer.
  useCalendarOccurrencesQuery(
    () => ({ userId: userId(), range: range() }),
    () => ({
      enabled: isCalendarRangeSupported(range()),
      pollWhileSyncing: false,
      refetchOnWindowFocus: false,
    })
  );
  return null;
}

/** Warm data beyond the DOM ring without mounting extra calendar grids. */
export function CalendarPagePreloads() {
  const pager = useCalendarPager();
  return (
    <For each={pager.preloadPositions()}>
      {(position) => <CalendarRangePreload position={position} />}
    </For>
  );
}
