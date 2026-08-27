import type { CalendarEvent, CalendarSource } from '../types';

/** A person attributed on an event: organizer or creator. */
export interface CalendarPerson {
  displayName?: string;
  email?: string;
  isSelf: boolean;
}

/** Calendar, creator, and organizer rows for the event details popover. */
export interface EventAttribution {
  calendarName: string;
  creator?: CalendarPerson;
  organizer?: CalendarPerson;
}

function normalize(value?: string) {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function emailsEqual(left?: string, right?: string) {
  const first = normalize(left)?.toLowerCase();
  const second = normalize(right)?.toLowerCase();
  return first !== undefined && first === second;
}

function namesEqual(left?: string, right?: string) {
  const first = normalize(left)?.toLowerCase();
  const second = normalize(right)?.toLowerCase();
  return first !== undefined && first === second;
}

function sameAsCalendar(person: CalendarPerson, calendar: CalendarSource) {
  const personName = normalize(person.displayName);
  const calendarName = normalize(calendar.name);
  if (personName && calendarName) {
    if (namesEqual(personName, calendarName)) return true;
    if (
      calendarName.toLowerCase().startsWith(`${personName.toLowerCase()} —`)
    ) {
      return true;
    }
  }

  if (person.email && emailsEqual(person.email, calendar.name)) {
    return true;
  }

  // The connected inbox identifies the calendar only on the account primary.
  // On a shared calendar it is the viewer's inbox, not the calendar owner —
  // matching it would hide "Created by" when you write onto someone else's
  // calendar through your own grant.
  return (
    calendar.isPrimary === true &&
    person.email !== undefined &&
    emailsEqual(person.email, calendar.emailAddress)
  );
}

function findOrganizer(event: CalendarEvent): CalendarPerson | undefined {
  const organizerAttendee = event.attendees.find(
    (attendee) => attendee.isOrganizer
  );
  const displayName =
    event.organizerName ?? organizerAttendee?.displayName ?? undefined;
  const email = event.organizerEmail ?? organizerAttendee?.email;

  return displayName || email
    ? { displayName, email, isSelf: organizerAttendee?.isSelf ?? false }
    : undefined;
}

function findCreator(event: CalendarEvent): CalendarPerson | undefined {
  const displayName = event.creatorName;
  const email = event.creatorEmail;
  if (!displayName && !email) return undefined;

  const attendee = event.attendees.find((candidate) =>
    emailsEqual(candidate.email, email)
  );
  return { displayName, email, isSelf: attendee?.isSelf ?? false };
}

/**
 * Splits the calendar the event lives on from who created it and who
 * organizes it. Google reports the calendar owner as organizer when someone
 * writes onto a shared calendar; the creator is the writer.
 */
export function eventAttribution(event: CalendarEvent): EventAttribution {
  const organizer = findOrganizer(event);
  const creator = findCreator(event);
  const showCreator =
    creator !== undefined &&
    !sameAsCalendar(creator, event.calendar) &&
    (organizer === undefined || sameAsCalendar(organizer, event.calendar));
  const showOrganizer =
    organizer !== undefined && !sameAsCalendar(organizer, event.calendar);

  return {
    calendarName: event.calendar.name || 'Calendar',
    creator: showCreator ? creator : undefined,
    organizer: showOrganizer ? organizer : undefined,
  };
}
