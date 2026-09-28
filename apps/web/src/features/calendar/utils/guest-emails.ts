import type { CalendarAttendee } from '@service-storage/generated/schemas/calendarAttendee';
import type { CalendarEvent } from '../types';

/**
 * Every guest's address once, in guest-list order, blanks dropped — what
 * "Copy guest emails" puts on the clipboard.
 */
export function guestEmails(attendees: CalendarAttendee[]): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const attendee of attendees) {
    const email = attendee.email.trim();
    const key = email.toLowerCase();
    if (email === '' || seen.has(key)) continue;
    seen.add(key);
    emails.push(email);
  }
  return emails;
}

/**
 * Who a new email about the event goes to: every guest except the viewer's
 * own inboxes. Empty when the viewer is the only guest, so callers can hide
 * the action instead of opening a composer addressed to nobody.
 */
export function eventEmailRecipients(event: CalendarEvent): string[] {
  return guestEmails(event.attendees.filter((attendee) => !attendee.isSelf));
}
