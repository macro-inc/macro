import {
  enableCalendarUi,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { openCalendarView } from './calendar-navigation';
import { type CalendarEventTime, createCalendarRange } from './calendar-range';

export type CalendarEventOpenTarget = {
  /** The viewer's own event entity to focus. */
  eventId: string;
  /** Instance to focus, for recurring events. */
  occurrenceKey?: string;
  /** Instance timing used to build the locator range. */
  time?: CalendarEventTime;
  openInNewSplit?: boolean;
};

/**
 * Timed occurrence keys are the instance's RFC 3339 start and all-day keys
 * its YYYY-MM-DD start date, so a key alone can anchor the locator range
 * when no richer timing is at hand.
 */
export function eventTimeFromOccurrenceKey(
  occurrenceKey: string
): CalendarEventTime | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(occurrenceKey)) {
    return { kind: 'allDay', startDate: occurrenceKey };
  }
  const startsAt = new Date(occurrenceKey);
  if (!Number.isFinite(startsAt.getTime())) return undefined;
  return { kind: 'timed', startsAt: occurrenceKey };
}

/** Open or retarget the singleton Calendar application view. */
export async function openCalendarEventSplit(target: CalendarEventOpenTarget) {
  if (!isFeatureEnabled(enableCalendarUi)) return;
  const time =
    target.time ??
    (target.occurrenceKey
      ? eventTimeFromOccurrenceKey(target.occurrenceKey)
      : undefined);

  openCalendarView(
    {
      eventId: target.eventId,
      occurrenceKey: target.occurrenceKey,
      range: time ? createCalendarRange(time) : undefined,
    },
    { openInNewSplit: target.openInNewSplit }
  );
}
