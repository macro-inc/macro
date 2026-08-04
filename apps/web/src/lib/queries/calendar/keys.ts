import { createQueryKeys } from '@lukemorales/query-key-factory';

export interface CalendarOccurrenceQueryRange {
  start: string;
  end: string;
  startDate: string;
  endDate: string;
}

export const calendarKeys = createQueryKeys('calendar', {
  occurrences: (
    userId: string,
    range: CalendarOccurrenceQueryRange | undefined
  ) => ({
    queryKey: [userId, range],
  }),
});
