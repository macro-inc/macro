import { createQueryKeys } from '@lukemorales/query-key-factory';

export interface CalendarOccurrenceQueryRange {
  start: string;
  end: string;
  startDate: string;
  endDate: string;
}

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
