import { useUserId } from '@core/context/user';
import {
  type CalendarOccurrenceQueryRange,
  type CalendarOccurrencesQueryOptions,
  useCalendarOccurrencesQuery,
} from '@queries/calendar/occurrences';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { type Accessor, createMemo } from 'solid-js';
import {
  type CalendarEvent,
  type CalendarSource,
  isCalendarEventVisible,
  mapCalendarOccurrenceChips,
} from '../types';
import { isCalendarRangeSupported } from '../utils/calendar-supported-range';

export interface CalendarOccurrenceData {
  range: Accessor<CalendarOccurrenceQueryRange | undefined>;
  occurrencesQuery: ReturnType<typeof useCalendarOccurrencesQuery>;
  events: Accessor<CalendarEvent[]>;
  visibleEvents: Accessor<CalendarEvent[]>;
  eventsById: Accessor<Map<string, CalendarEvent>>;
  isLoading: Accessor<boolean>;
  isSyncing: Accessor<boolean>;
}

export interface CalendarOccurrenceDataOptions {
  range: Accessor<CalendarOccurrenceQueryRange | undefined>;
  sourceById?: Accessor<ReadonlyMap<string, CalendarSource>>;
  isSourceVisible?: (sourceId: string) => boolean;
  queryOptions?: Accessor<CalendarOccurrencesQueryOptions>;
}

/** Query-backed occurrence data shared by calendar rendering surfaces. */
export function useCalendarOccurrenceData(
  options: CalendarOccurrenceDataOptions
): CalendarOccurrenceData {
  const userId = useUserId();
  const isRangeSupported = createMemo(() => {
    const range = options.range();
    return range !== undefined && isCalendarRangeSupported(range);
  });
  const occurrencesQuery = useCalendarOccurrencesQuery(
    () => ({ userId: userId(), range: options.range() }),
    () => {
      const queryOptions = options.queryOptions?.();
      return {
        ...queryOptions,
        enabled: isRangeSupported() && queryOptions?.enabled !== false,
      };
    }
  );
  const events = createMemo(() => {
    if (!isRangeSupported()) return [];
    const sourceById = options.sourceById?.();
    return (occurrencesQuery.data?.items ?? []).flatMap((item) =>
      mapCalendarOccurrenceChips(item, { sourceById })
    );
  });
  const visibleEvents = createMemo(() =>
    events().filter((event) =>
      isCalendarEventVisible(event, options.isSourceVisible)
    )
  );
  const eventsById = createMemo(
    () => new Map(events().map((event) => [event.id, event]))
  );
  const isLoading = () =>
    options.range() === undefined ||
    (isRangeSupported() &&
      (occurrencesQuery.isPending || occurrencesQuery.isPlaceholderData));
  const isSyncing = () =>
    occurrencesQuery.data?.syncStatus === CalendarSyncStatus.syncing;

  return {
    range: options.range,
    occurrencesQuery,
    events,
    visibleEvents,
    eventsById,
    isLoading,
    isSyncing,
  };
}
