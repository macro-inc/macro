import { globalSplitManager } from '@app/signal/splitLayout';
import {
  enableCalendarUi,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import {
  type CalendarBlockEventTime,
  createCalendarBlockRange,
} from './calendar-range';
import { CALENDAR_BLOCK_ID, type CalendarBlockProps } from './types';

export type CalendarEventOpenTarget = {
  /** The viewer's own event entity to focus. */
  eventId: string;
  /** Instance to focus, for recurring events. */
  occurrenceKey?: string;
  /** Instance timing used to build the locator range. */
  time?: CalendarBlockEventTime;
  openInNewSplit?: boolean;
};

/**
 * Timed occurrence keys are the instance's RFC 3339 start and all-day keys
 * its YYYY-MM-DD start date, so a key alone can anchor the locator range
 * when no richer timing is at hand.
 */
export function eventTimeFromOccurrenceKey(
  occurrenceKey: string
): CalendarBlockEventTime | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(occurrenceKey)) {
    return { kind: 'allDay', startDate: occurrenceKey };
  }
  const startsAt = new Date(occurrenceKey);
  if (!Number.isFinite(startsAt.getTime())) return undefined;
  return { kind: 'timed', startsAt: occurrenceKey };
}

/**
 * Open the singleton calendar block focused on one event occurrence,
 * mirroring how soup rows and notifications retarget the calendar. Repeat
 * opens re-aim the already-open split instead of stacking another calendar.
 */
export async function openCalendarEventSplit(target: CalendarEventOpenTarget) {
  if (!isFeatureEnabled(enableCalendarUi)) return;
  const splitManager = globalSplitManager();
  if (!splitManager) return;

  const time =
    target.time ??
    (target.occurrenceKey
      ? eventTimeFromOccurrenceKey(target.occurrenceKey)
      : undefined);
  const params: CalendarBlockProps = {
    eventId: target.eventId,
    occurrenceKey: target.occurrenceKey,
    range: time ? createCalendarBlockRange(time) : undefined,
  };

  const existing = splitManager.getSplitByContent(
    'calendar',
    CALENDAR_BLOCK_ID
  );
  if (existing) {
    existing.activate();
  } else {
    splitManager.openWithSplit(
      { type: 'calendar', id: CALENDAR_BLOCK_ID, params },
      {
        activate: true,
        referredFrom: null,
        preferNewSplit: target.openInNewSplit,
      }
    );
  }

  const orchestrator = splitManager.getOrchestrator();
  const handle = await orchestrator.getBlockHandle(
    CALENDAR_BLOCK_ID,
    'calendar'
  );
  await handle?.goToLocationFromParams(params);
}
