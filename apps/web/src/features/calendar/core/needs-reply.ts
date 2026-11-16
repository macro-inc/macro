import type { CalendarEvent } from '../types';

/** Only the viewer's actionable, unanswered invitation belongs in Needs reply. */
export function needsCalendarReply(
  event: Pick<
    CalendarEvent,
    'viewerCan' | 'attendees' | 'isCancelled' | 'isSnapshot'
  >
): boolean {
  if (event.isCancelled || event.isSnapshot || !event.viewerCan.rsvp)
    return false;
  return event.attendees.some(
    (attendee) => attendee.isSelf && attendee.responseStatus === 'needs_action'
  );
}
