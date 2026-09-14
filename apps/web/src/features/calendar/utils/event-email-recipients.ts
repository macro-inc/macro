import type { CalendarEvent } from '../types';

/**
 * Who a new email about the event goes to: every attendee except the viewer's
 * own inboxes, in guest-list order, each address once. Empty when the viewer
 * is the only guest, so callers can hide the action instead of opening a
 * composer addressed to nobody.
 */
export function eventEmailRecipients(event: CalendarEvent): string[] {
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const attendee of event.attendees) {
    if (attendee.isSelf) continue;
    const email = attendee.email.trim();
    const key = email.toLowerCase();
    if (email === '' || seen.has(key)) continue;
    seen.add(key);
    recipients.push(email);
  }
  return recipients;
}
