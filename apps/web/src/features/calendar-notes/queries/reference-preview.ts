import type { CalendarMentionEvent } from '@service-calendar/generated/schemas/calendarMentionEvent';
import type { DocumentReference } from './notes-source';

/** Mentions may fall forward to another instance; durable note links never do. */
export function resolveReferencePreview(link: DocumentReference) {
  if (!link.canViewMeeting) return undefined;
  const preview = link.event;
  const exact =
    preview &&
    (link.occurrenceKey === 'single'
      ? !preview.isRecurring
      : preview.occurrenceKey === link.occurrenceKey);
  if (exact) return { event: preview, sharedActions: false };
  const team = link.teamEvent;
  if (team?.kind !== 'details') return undefined;
  return {
    event: {
      ...team.details,
      time: team.time,
      viewerEventId: null,
      occurrenceKey:
        link.occurrenceKey === 'single' ? undefined : link.occurrenceKey,
      isRecurring: link.occurrenceKey !== 'single',
      attendeeCount: team.details.attendees.length,
    } satisfies Omit<CalendarMentionEvent, 'updatedAt'>,
    sharedActions: false,
  };
}
