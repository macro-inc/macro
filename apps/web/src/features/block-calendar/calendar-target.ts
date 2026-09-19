import { parseLocalDate } from '@app/features/calendar/utils/calendar-date';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { CalendarFocusTarget } from './calendar-focus-target';
import type { CalendarBlockTargetRequest } from './types';

function occurrenceDate(item: CalendarOccurrenceItem): Date | undefined {
  const time = item.occurrence.time;
  const date =
    time.kind === 'timed'
      ? new Date(time.startsAt)
      : parseLocalDate(time.startDate);
  return date && Number.isFinite(date.getTime()) ? date : undefined;
}

/**
 * Resolves a block request to one occurrence. Without an occurrence key the
 * supplied range must contain exactly one instance of the canonical event.
 */
export function resolveCalendarBlockTarget(
  items: CalendarOccurrenceItem[],
  request: CalendarBlockTargetRequest
): CalendarFocusTarget | undefined {
  const matches = items.filter(
    (item) =>
      item.event.id === request.eventId &&
      (request.occurrenceKey === undefined ||
        item.occurrence.occurrenceKey === request.occurrenceKey)
  );
  if (matches.length !== 1) return undefined;

  const item = matches[0];
  const date = occurrenceDate(item);
  if (!date) return undefined;

  return {
    eventId: item.event.id,
    occurrenceKey: item.occurrence.occurrenceKey,
    date,
    requestId: request.requestId,
    requestedAt: request.requestedAt,
  };
}
