import { fireAndForget } from '@core/util/fireAndForget';
import { parseLocalDate } from '@core/util/local-date';
import { Telemetry } from '@macro-inc/observability';
import { syncCalendarOccurrences } from '@queries/calendar/occurrences';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import { type Accessor, createEffect, createMemo } from 'solid-js';
import type { CalendarFocusTarget } from './calendar-focus-target';
import type { CalendarFocusRequest } from './types';

function occurrenceDate(item: CalendarOccurrenceItem): Date | undefined {
  const time = item.occurrence.time;
  const date =
    time.kind === 'timed'
      ? new Date(time.startsAt)
      : parseLocalDate(time.startDate);
  return date && Number.isFinite(date.getTime()) ? date : undefined;
}

/**
 * Resolves a navigation request to one occurrence. Without an occurrence key the
 * supplied range must contain exactly one instance of the canonical event.
 */
export function resolveCalendarTarget(
  items: CalendarOccurrenceItem[],
  request: CalendarFocusRequest
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

/** The locator occurrence query, as far as target resolution reads it. */
interface CalendarLocatorQuery {
  readonly isSuccess: boolean;
  readonly data?: { items: CalendarOccurrenceItem[] };
}

/**
 * The occurrence the calendar is aimed at, resolved from the locator query
 * over the request's range.
 *
 * The tab's calendar data can predate the target: a copy just added from a
 * shared-event card while no calendar was open reaches a cached week only on
 * a later sync, long after the request has expired. When the locator answers
 * without the event, the calendar data is brought forward once per request
 * (a delta sync, waiting for a cache that is still starting, then a refetch),
 * so the target can still land.
 */
export function createCalendarFocusTarget(
  request: Accessor<CalendarFocusRequest | undefined>,
  locator: CalendarLocatorQuery,
  refreshCalendar: () => Promise<unknown> = syncCalendarOccurrences
): Accessor<CalendarFocusTarget | undefined> {
  // A cold `.data` read suspends the nearest <Suspense>, which is the one
  // wrapping each calendar page: the first aim of a session enables this
  // query, so reading it unguarded blanks the whole grid for the length of
  // the fetch and remounts it. There is no target to resolve until the
  // occurrences land anyway.
  const target = createMemo(() => {
    const current = request();
    if (!current || !locator.isSuccess) return undefined;
    return resolveCalendarTarget(locator.data?.items ?? [], current);
  });

  let refreshedRequestId: number | undefined;
  createEffect(() => {
    const current = request();
    if (!current || !locator.isSuccess || target()) return;
    if (refreshedRequestId === current.requestId) return;
    refreshedRequestId = current.requestId;
    fireAndForget(
      Telemetry.span('calendar.focus_target_refresh', async (span) => {
        span.setAttr('calendar.event_id', current.eventId);
        await refreshCalendar();
      }),
      'calendar-target'
    );
  });

  return target;
}
