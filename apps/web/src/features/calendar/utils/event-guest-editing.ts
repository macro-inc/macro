import { eventGuestEmails } from '../components/composer/event-form-model';
import type { CalendarEvent } from '../types';

function normalizeGuestEmails(emails: readonly string[]): string[] {
  return [...new Set(emails.map((email) => email.trim().toLowerCase()))].sort();
}

function emailListsEqual(first: readonly string[], second: readonly string[]) {
  const left = normalizeGuestEmails(first);
  const right = normalizeGuestEmails(second);
  return (
    left.length === right.length &&
    left.every((email, index) => email === right[index])
  );
}

/**
 * Whether the viewer may change the guest list of an existing event. A
 * read-only event never qualifies. Otherwise only the organizer can: the
 * editor's replacement attendee list would otherwise drop the viewer, whose
 * own email is seeded only when they organize the event.
 *
 * A writable event with no attendees at all is treated as the viewer's own
 * (a solo event they created), so the first guest can still be added — there
 * is no attendee to drop in that case.
 */
export function viewerCanEditGuests(event: CalendarEvent): boolean {
  if (event.isReadOnly) return false;
  const organizer = event.attendees.find((attendee) => attendee.isOrganizer);
  if (organizer) return organizer.isSelf;
  return event.attendees.length === 0;
}

/**
 * Whether a submitted guest list differs from the event's current one.
 * Attendee updates replace the whole list and notify every guest, so the
 * update omits attendees when nothing changed.
 */
export function guestListChanged(
  event: CalendarEvent,
  nextGuestEmails: readonly string[]
): boolean {
  return !emailListsEqual(eventGuestEmails(event), nextGuestEmails);
}
