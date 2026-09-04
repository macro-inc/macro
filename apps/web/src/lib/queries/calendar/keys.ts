import { createQueryKeys } from '@lukemorales/query-key-factory';

export interface CalendarOccurrenceQueryRange {
  start: string;
  end: string;
  startDate: string;
  endDate: string;
}

/** Mutation key shared by the RSVP mutation and the websocket refresh
 * handler, which must not refetch occurrences over in-flight optimistic
 * RSVP state. */
export const RSVP_MUTATION_KEY = ['calendar', 'rsvp'] as const;

export const calendarKeys = createQueryKeys('calendar', {
  visibleCalendars: null,
  occurrences: (
    userId: string,
    range: CalendarOccurrenceQueryRange | undefined
  ) => ({
    queryKey: [userId, range],
  }),
  teamOutOfOffice: (
    userId: string,
    range: CalendarOccurrenceQueryRange | undefined
  ) => ({
    queryKey: [userId, range],
  }),
  mentionPreview: (eventId: string, occurrenceKey: string | undefined) => ({
    queryKey: [eventId, occurrenceKey],
  }),
});
