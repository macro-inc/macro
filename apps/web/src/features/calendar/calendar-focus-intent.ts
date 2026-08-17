import { createSignal } from 'solid-js';

/**
 * How long a requested focus stays claimable. A stale intent must not hijack
 * a later visit to the calendar — without this, a chip mounting minutes after
 * a failed navigation would still pop its details open.
 */
const FOCUS_INTENT_TTL_MS = 15_000;

/** A request to page the calendar to one occurrence and open its details. */
export interface CalendarFocusIntent {
  /** Canonical calendar event entity id. */
  eventId: string;
  /** Stable occurrence key within the event. */
  occurrenceKey: string;
  /** Occurrence start, used to page the calendar to the right date. */
  date: Date;
  /** When the intent was made, for staleness checks. */
  requestedAt: number;
}

const [pendingIntent, setPendingIntent] = createSignal<CalendarFocusIntent>();

/** The grid's composite view-model id for an intent's occurrence. */
export function calendarFocusTargetId(intent: CalendarFocusIntent): string {
  return JSON.stringify([intent.eventId, intent.occurrenceKey]);
}

/**
 * Ask the calendar view to page to an occurrence and open its details.
 * Module-level rather than context state because the producer (notification
 * navigation) runs outside the calendar's providers, and the split it opens
 * only mounts them afterwards.
 */
export function requestCalendarFocus(
  intent: Omit<CalendarFocusIntent, 'requestedAt'>
) {
  setPendingIntent({ ...intent, requestedAt: Date.now() });
}

/** The pending focus request, dropping one that has gone stale. */
export function pendingCalendarFocus(): CalendarFocusIntent | undefined {
  const intent = pendingIntent();
  if (!intent) return undefined;
  if (Date.now() - intent.requestedAt > FOCUS_INTENT_TTL_MS) {
    setPendingIntent(undefined);
    return undefined;
  }
  return intent;
}

/** Consume the pending focus request. */
export function clearCalendarFocus() {
  setPendingIntent(undefined);
}
