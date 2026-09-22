import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type {
  CalendarInvitation,
  InvitationDateTime,
} from '../../email-message/core/calendar-invitation';

const instant = (value: InvitationDateTime | null | undefined) => {
  if (!value || value.kind === 'unresolved') return undefined;
  const date = new Date(
    value.kind === 'date' ? `${value.value}T00:00:00` : value.value
  );
  return Number.isFinite(date.getTime()) ? date.getTime() : undefined;
};

/** Availability uses busy, noncancelled, nondeclined occurrences and exclusive ends. */
export function invitationConflicts(
  invitation: CalendarInvitation,
  item: CalendarOccurrenceItem,
  target: { eventId: string; occurrenceKey: string }
): boolean {
  if (
    (item.event.id === target.eventId &&
      item.occurrence.occurrenceKey === target.occurrenceKey) ||
    item.event.status === 'cancelled' ||
    item.occurrence.isCancelled ||
    item.event.transparency === 'transparent' ||
    item.event.attendees.some(
      (a) => a.isSelf && a.responseStatus === 'declined'
    )
  )
    return false;
  const start = instant(invitation.start);
  const end = instant(invitation.end);
  if (start === undefined || end === undefined) return false;
  const time = item.occurrence.time;
  const otherStart = new Date(
    time.kind === 'timed' ? time.startsAt : `${time.startDate}T00:00:00`
  ).getTime();
  const otherEnd = new Date(
    time.kind === 'timed' ? time.endsAt : `${time.endDate}T00:00:00`
  ).getTime();
  return start < otherEnd && end > otherStart;
}
