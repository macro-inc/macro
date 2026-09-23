import {
  isCalendarEventPreviewItem,
  type PreviewItem,
} from '@queries/preview/types';
import type { CalendarEventOpenTarget } from './open-calendar-event';

/** What opening a calendar event mention does for the current viewer. */
export type CalendarMentionOpen =
  | {
      kind: 'calendar';
      target: Omit<CalendarEventOpenTarget, 'openInNewSplit'>;
    }
  /**
   * The meeting is on none of the viewer's calendars: they see it only
   * because it was shared with one of their channels, so there is no event
   * of theirs to open and the preview card is the whole experience.
   */
  | { kind: 'read_only' };

/**
 * Resolve a calendar mention to the viewer's own copy of the meeting, which
 * the preview found through the shared iCalendar UID. Without an accessible
 * preview (e.g. the recent-mention fallback for a just-created event) the
 * mentioned id is still routed through the singleton calendar opener.
 */
export function calendarMentionOpen(
  item: PreviewItem,
  mentionedEventId: string,
  occurrenceKey?: string
): CalendarMentionOpen {
  if (!isCalendarEventPreviewItem(item)) {
    return {
      kind: 'calendar',
      target: { eventId: mentionedEventId, occurrenceKey },
    };
  }
  const { event } = item;
  if (!event.viewerEventId) return { kind: 'read_only' };
  return {
    kind: 'calendar',
    target: {
      eventId: event.viewerEventId,
      occurrenceKey: occurrenceKey ?? event.occurrenceKey ?? undefined,
      // The preview's time only locates the instance it previewed; a
      // mention aimed at a different instance derives its range from the
      // occurrence key instead.
      time:
        !occurrenceKey || occurrenceKey === event.occurrenceKey
          ? event.time
          : undefined,
    },
  };
}
