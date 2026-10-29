import { rangeTimeZoneLabel } from '../availability/zone-label';
import type { CalendarEvent, CalendarTimeFormat } from '../types';
import { calendarDescriptionText } from './calendar-description';
import { type CalendarPerson, findOrganizer } from './event-attribution';
import { formatEventSchedule, parseCalendarDate } from './event-schedule';
import {
  calendarMacroCallUrl,
  removeCalendarMacroCall,
} from './macro-call-link';
import { eventRecurrenceDescription } from './recurrence';

/** What an event is called in a file name or an email subject. */
export function eventDisplayTitle(event: Pick<CalendarEvent, 'title'>) {
  return event.title.trim() || 'Untitled event';
}

function personLabel(person: CalendarPerson) {
  const name = person.displayName?.trim();
  const email = person.email?.trim();
  if (name && email && name !== email) return `${name} <${email}>`;
  return name || email;
}

/**
 * The body of an email forwarding an event: the fields its `.ics` carries, in
 * words, with the time in the viewer's zone. Like the file, it leaves out the
 * guest list and the join link.
 */
export function eventForwardSummary(
  event: CalendarEvent,
  timeFormat: CalendarTimeFormat
): string {
  const content = removeCalendarMacroCall(event, calendarMacroCallUrl(event));
  const schedule = formatEventSchedule(event, timeFormat);
  const zone = event.allDay
    ? undefined
    : rangeTimeZoneLabel([
        parseCalendarDate(event.start),
        parseCalendarDate(event.end),
      ]);
  const recurrence = eventRecurrenceDescription(event);
  const location = content.location.trim();
  const organizer = findOrganizer(event);
  const lines = [
    eventDisplayTitle(event),
    `When: ${zone ? `${schedule} (${zone})` : schedule}`,
    recurrence && `Repeats: ${recurrence}`,
    location && `Where: ${location}`,
    organizer && `Organizer: ${personLabel(organizer)}`,
  ].filter(Boolean);
  const description = calendarDescriptionText(content.description);
  return description
    ? `${lines.join('\n')}\n\n${description}`
    : lines.join('\n');
}
