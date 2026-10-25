import { eventGuestEmails } from '../components/composer/event-form-model';
import type { CalendarEvent } from '../types';

/** Shown where a guest would add guests when the organizer does not allow it. */
export const GUEST_INVITES_RESTRICTED = 'Only the organizer can invite guests.';

/**
 * Shown where a guest would add guests when the organizer allows inviting
 * but hides the guest list; the server refuses with the same words.
 */
export const GUEST_LIST_HIDDEN =
  'Guests cannot be added while the organizer hides the guest list.';

/** Shown where a guest would change the event when the organizer does not allow it. */
export const GUEST_EDITS_RESTRICTED =
  'Only the organizer can change this event.';

/**
 * Whether the viewer is a guest the organizer does not let modify the event,
 * or holds a snapshot of a shared meeting, so its title, time, description,
 * location, recurrence and conferencing stay as the organizer set them.
 * Reminders stay the viewer's own. Someone neither organizing nor invited
 * keeps what their calendar access allows, as on the server.
 */
export function guestEditsRestricted(event: CalendarEvent): boolean {
  return (
    event.isSnapshot === true ||
    (event.viewerCan.rsvp && !event.viewerCan.editDetails)
  );
}

function normalizeGuestEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeGuestEmails(emails: readonly string[]): string[] {
  return [...new Set(emails.map(normalizeGuestEmail))].sort();
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
 * How the viewer may change an existing event's guest list.
 *
 * - `replace`: add and remove guests; a save replaces the whole list.
 * - `add`: add guests through an invitation; the current guests stay fixed.
 * - `none`: the list is read-only.
 */
export type EventGuestEditing = 'replace' | 'add' | 'none';

/**
 * Whether the viewer may replace the event's guest list. Only the organizer
 * does: the editor's list omits a guest's own entry, so a guest's
 * replacement would drop them, and guests add but never remove.
 */
export function viewerReplacesGuests(event: CalendarEvent): boolean {
  return !event.isReadOnly && !event.teamProjection && event.viewerCan.organize;
}

/**
 * How the viewer may change an existing event's guest list, from the
 * server's capabilities. A guest the organizer lets invite adds through a
 * separate invitation, while guest invites are enabled.
 */
export function eventGuestEditing(
  event: CalendarEvent,
  invitesEnabled: boolean
): EventGuestEditing {
  if (viewerReplacesGuests(event)) return 'replace';
  if (
    invitesEnabled &&
    !event.isReadOnly &&
    !event.teamProjection &&
    event.viewerCan.inviteGuests
  ) {
    return 'add';
  }
  return 'none';
}

/**
 * Whether the viewer is a guest on a writable event whose organizer does not
 * let guests invite others, so the guest list explains why it cannot grow. A
 * snapshot lists the viewer only so Google would take it; the details
 * already say it is a copy.
 */
export function guestInvitesRestricted(event: CalendarEvent): boolean {
  return (
    !event.isReadOnly &&
    !event.teamProjection &&
    !event.isSnapshot &&
    !event.viewerCan.inviteGuests &&
    event.attendees.some((attendee) => attendee.isSelf)
  );
}

/**
 * Whether the organizer hides the guest list from the viewer, a guest on
 * their own copy. Google then gives that copy only the viewer and perhaps the
 * organizer, so its attendees are not the real guest list.
 */
export function guestListHidden(event: CalendarEvent): boolean {
  return (
    !event.isSnapshot &&
    !event.viewerCan.organize &&
    !event.guestPolicy.canSeeOtherGuests &&
    event.attendees.some((attendee) => attendee.isSelf)
  );
}

/**
 * Why the viewer's guest list cannot grow, when it is worth saying. Google
 * would let a guest the organizer lets invite add guests to a hidden list,
 * but Macro cannot, since a guest's copy of that list is incomplete.
 */
export function guestInvitesRestrictedReason(
  event: CalendarEvent
): string | undefined {
  if (!guestInvitesRestricted(event)) return undefined;
  const policy = event.guestPolicy;
  return guestListHidden(event) && (policy.canInviteOthers || policy.canModify)
    ? GUEST_LIST_HIDDEN
    : GUEST_INVITES_RESTRICTED;
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

/** Submitted guests the event does not have yet, in submitted order. */
export function addedGuestEmails(
  event: CalendarEvent,
  nextGuestEmails: readonly string[]
): string[] {
  const seen = new Set(
    event.attendees.map((attendee) => normalizeGuestEmail(attendee.email))
  );
  return nextGuestEmails.filter((email) => {
    const normalized = normalizeGuestEmail(email);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
