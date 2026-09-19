import type { CalendarEvent } from '@app/features/calendar/types';
import { toast } from '@core/component/Toast/Toast';
import { writeClipboardData } from '@core/util/dataTransfer';
import { CALENDAR_BLOCK_ID } from './types';

/** What a copied event needs to come back as a mention or a deep link. */
export type CalendarMentionTarget = {
  eventId: string;
  title: string;
  /** Pins one instance of a recurring series; absent for a series mention. */
  occurrenceKey?: string;
};

function isRecurring(event: CalendarEvent): boolean {
  return event.recurrenceLines.length > 0 || event.recurrenceId !== undefined;
}

/**
 * The same span shape `DocumentMentionNode.exportDOM` copies, so pasting
 * into any Macro editor reconstructs a live calendar mention through
 * `importDOM`. A series mention names the whole event; an instance of a
 * recurring event pins its occurrence key.
 */
function mentionHtml(target: CalendarMentionTarget): string {
  const span = document.createElement('span');
  span.setAttribute('data-document-mention', 'true');
  span.setAttribute('data-document-id', target.eventId);
  span.setAttribute('data-document-name', target.title);
  span.setAttribute('data-block-name', 'calendar');
  if (target.occurrenceKey) {
    span.setAttribute(
      'data-block-params',
      JSON.stringify({ occurrenceKey: target.occurrenceKey })
    );
  }
  span.textContent = target.title;
  return span.outerHTML;
}

/**
 * Deep link to one event on the singleton calendar block, using the same
 * host convention as the copy-link actions elsewhere in the app.
 */
export function calendarEventDeepLink(target: {
  eventId: string;
  occurrenceKey?: string;
}): string {
  let hostname = window.location.hostname.replace('www.', '').toLowerCase();
  if (hostname === 'localhost') {
    hostname = 'dev.macro.com';
  }
  const params = new URLSearchParams({
    eventId: target.eventId,
    ...(target.occurrenceKey ? { occurrenceKey: target.occurrenceKey } : {}),
  });
  return `https://${hostname}/app/calendar/${CALENDAR_BLOCK_ID}?${params.toString()}`;
}

/**
 * Copy an event to the clipboard as a calendar mention (rich flavor) with a
 * deep link fallback (plain flavor). Must be called from a user gesture.
 */
export async function copyCalendarEventMentionTarget(
  target: CalendarMentionTarget
) {
  const written = await writeClipboardData({
    'text/html': mentionHtml(target),
    'text/plain': calendarEventDeepLink(target),
  });
  if (written) {
    toast.success('Copied event to clipboard');
  } else {
    toast.failure('Failed to copy event');
  }
}

/** Copy a calendar-grid event, pinning the instance when it repeats. */
export async function copyCalendarEventMention(event: CalendarEvent) {
  await copyCalendarEventMentionTarget({
    eventId: event.eventId,
    title: event.title,
    occurrenceKey: isRecurring(event) ? event.occurrenceKey : undefined,
  });
}
