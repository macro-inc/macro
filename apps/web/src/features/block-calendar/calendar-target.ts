import type { CalendarFocusTarget } from '@app/features/calendar/calendar-focus-target';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { CalendarBlockTargetRequest } from './types';

function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  return date.getFullYear() === year &&
    date.getMonth() === month &&
    date.getDate() === day
    ? date
    : undefined;
}

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
