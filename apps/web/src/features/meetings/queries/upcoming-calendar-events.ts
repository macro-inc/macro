import {
  createCalendarOccurrenceQueryRange,
  useCalendarOccurrencesQuery,
} from '@queries/calendar/occurrences';
import { type Accessor, createMemo } from 'solid-js';
import {
  type CalendarEvent,
  type CalendarSource,
  isCalendarEventVisible,
  mapCalendarOccurrence,
} from '../../calendar/types';
import { safeConferenceUrl } from '../../calendar/utils/conference-link';
import { calendarMacroCallUrl } from '../../calendar/utils/macro-call-link';
import {
  selectUpcomingCalendarEvents,
  type UpcomingCalendarEvent,
} from '../core/upcoming-calendar-events';

// Stop once five events are found; only sparse calendars reach the full horizon.
const WINDOW_END_DAYS = [14, 30, 90, 180, 365, 729];
const TARGET_EVENT_COUNT = 5;

type SourceOptions = {
  userId: Accessor<string | undefined>;
  sourceById: Accessor<ReadonlyMap<string, CalendarSource>>;
  isSourceVisible: (sourceId: string) => boolean;
  now: Accessor<Date>;
};

type OccurrenceWindow = {
  query: ReturnType<typeof useCalendarOccurrencesQuery>;
  enabled: Accessor<boolean>;
  events: Accessor<UpcomingCalendarEvent[]>;
  calendarEvents: Accessor<CalendarEvent[]>;
};

/** A rolling agenda independent of the date currently shown in the grid. */
export function useUpcomingCalendarEventsSource(options: SourceOptions) {
  const today = createMemo(() => {
    const date = new Date(options.now());
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  });
  const windows: OccurrenceWindow[] = [];
  for (const [index, endDays] of WINDOW_END_DAYS.entries()) {
    const previous = windows.slice();
    const enabled = () =>
      Boolean(options.userId()) &&
      previous.every(
        ({ query }) => query.isSuccess && !query.isPlaceholderData
      ) &&
      selectUpcomingCalendarEvents(
        previous.flatMap((window) => window.events()),
        options.now()
      ).length < TARGET_EVENT_COUNT;
    const range = createMemo(() => {
      const start = new Date(today());
      start.setDate(start.getDate() + (WINDOW_END_DAYS[index - 1] ?? 0));
      const end = new Date(today());
      end.setDate(end.getDate() + endDays);
      return createCalendarOccurrenceQueryRange(start, end);
    });
    const query = useCalendarOccurrencesQuery(
      () => ({ userId: options.userId(), range: range() }),
      () => ({ enabled: enabled() })
    );
    const calendarEvents = createMemo(() => {
      if (!query.isSuccess || query.isPlaceholderData) return [];
      const sources = options.sourceById();
      return query.data.items.flatMap((item): CalendarEvent[] => {
        const event = mapCalendarOccurrence(item, {
          sourceById: sources,
          isSourceVisible: options.isSourceVisible,
        });
        if (
          event.isCancelled ||
          !isCalendarEventVisible(event, options.isSourceVisible) ||
          event.attendees.some(
            (person) => person.isSelf && person.responseStatus === 'declined'
          )
        ) {
          return [];
        }
        return [event];
      });
    });
    const events = createMemo(() =>
      calendarEvents().map(
        (event): UpcomingCalendarEvent => ({
          id: event.id,
          title: event.title,
          url:
            calendarMacroCallUrl(event) ??
            safeConferenceUrl(event.conferenceUrl),
          start: event.start,
          end: event.end,
          allDay: event.allDay,
          eventId: event.eventId,
          occurrenceKey: event.occurrenceKey,
        })
      )
    );
    windows.push({ query, enabled, events, calendarEvents });
  }

  const activeWindows = () => windows.filter((window) => window.enabled());
  return {
    events: createMemo(() =>
      selectUpcomingCalendarEvents(
        activeWindows().flatMap((window) => window.events()),
        options.now()
      )
    ),
    findEvent: (id: string) =>
      activeWindows()
        .flatMap((window) => window.calendarEvents())
        .find((event) => event.id === id),
    loading: () =>
      activeWindows().some(
        ({ query }) => query.isPending || query.isPlaceholderData
      ),
    error: () =>
      activeWindows().some(({ query }) => query.isError)
        ? 'Could not load upcoming events.'
        : undefined,
    refresh: () => {
      for (const { query } of activeWindows()) void query.refetch();
    },
  };
}
