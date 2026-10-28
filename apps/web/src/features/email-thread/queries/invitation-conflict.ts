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

const occurrenceBounds = (item: CalendarOccurrenceItem) => {
  const time = item.occurrence.time;
  return {
    start: new Date(
      time.kind === 'timed' ? time.startsAt : `${time.startDate}T00:00:00`
    ).getTime(),
    end: new Date(
      time.kind === 'timed' ? time.endsAt : `${time.endDate}T00:00:00`
    ).getTime(),
  };
};

/**
 * The occurrence is at the invitation's own time, so it can stand for the
 * invitation; a proposal or a newer email than the calendar has its own time.
 */
export function occurrenceAtInvitationTime(
  invitation: CalendarInvitation,
  item: CalendarOccurrenceItem
): boolean {
  const start = instant(invitation.start);
  if (start === undefined) return false;
  // An all-day invitation and a timed copy from midnight to midnight span the
  // same instants but are different times.
  const allDay = invitation.start?.kind === 'date';
  if (allDay !== (item.occurrence.time.kind === 'allDay')) return false;
  const end = instant(invitation.end);
  const occurrence = occurrenceBounds(item);
  return (
    start === occurrence.start && (end === undefined || end === occurrence.end)
  );
}

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
  const other = occurrenceBounds(item);
  return start < other.end && end > other.start;
}
