import { type CalendarEvent, isRecurringCalendarEvent } from '../types';
import { parseLocalDate } from './calendar-date';

const formatNotesDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** The occurrence's start as a local date, whether timed or all-day. */
function eventStartDate(start: string) {
  return parseLocalDate(start) ?? new Date(start);
}

/**
 * The name a new meeting-notes document gets: "Notes on <event> <date>", the
 * date being the occurrence's, so notes on a recurring meeting stay apart.
 */
export function meetingNotesTitle(
  event: Pick<CalendarEvent, 'title' | 'start'>
): string {
  const title = event.title.trim() || 'Untitled event';
  return `Notes on ${title} ${formatNotesDate.format(eventStartDate(event.start))}`;
}

/**
 * The document's initial markdown: a calendar mention of the event on the
 * first line, then an empty paragraph to type into. The mention carries the
 * same fields the editor exports, pinning the instance when the event
 * repeats. The trailing space-only line is the editor's convention for an
 * empty paragraph; a blank line would be dropped on import.
 */
export function meetingNotesContent(
  event: Pick<
    CalendarEvent,
    'eventId' | 'title' | 'occurrenceKey' | 'recurrenceLines' | 'recurrenceId'
  >
): string {
  const mention = JSON.stringify({
    documentId: event.eventId,
    documentName: event.title,
    blockName: 'calendar',
    blockParams: isRecurringCalendarEvent(event)
      ? { occurrenceKey: event.occurrenceKey }
      : {},
  });
  return `<m-document-mention>${mention}</m-document-mention>\n \n`;
}
