import { useUserId } from '@core/context/user';
import {
  createCalendarOccurrenceQueryRange,
  useCalendarOccurrencesQuery,
} from '@queries/calendar/occurrences';
import { queryReadyGate } from '@queries/gate';
import { addDays, startOfDay } from 'date-fns';
import { type Accessor, createMemo } from 'solid-js';
import { type CalendarEvent, mapCalendarOccurrence } from '../types';

/**
 * An open event as the calendar's occurrence cache now holds it, read over
 * the occurrence's own day, so what syncs while an editor is open reaches
 * the editor: the organizer taking away the viewer's rights, for one.
 * Undefined until that day loads, and once the occurrence is gone; a
 * failed refetch keeps the last copy, so a lock it brought holds.
 */
export function useSyncedCalendarEvent(
  event: Accessor<CalendarEvent | undefined>
): Accessor<CalendarEvent | undefined> {
  const userId = useUserId();
  const range = createMemo(() => {
    const current = event();
    if (!current) return undefined;
    const day = startOfDay(
      current.allDay
        ? new Date(`${current.start}T00:00:00`)
        : new Date(current.start)
    );
    return createCalendarOccurrenceQueryRange(day, addDays(day, 1));
  });
  const query = useCalendarOccurrencesQuery(() => ({
    userId: userId(),
    range: range(),
  }));

  return createMemo(() => {
    const current = event();
    if (!current || !queryReadyGate(query)) return undefined;
    const item = query.data.items.find(
      (candidate) =>
        candidate.occurrence.eventId === current.eventId &&
        candidate.occurrence.occurrenceKey === current.occurrenceKey
    );
    return item ? mapCalendarOccurrence(item) : undefined;
  });
}
