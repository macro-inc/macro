import { EventType } from '@service-storage/generated/schemas/eventType';
import type { CalendarEvent } from '../types';

/** A rendered calendar bar and every occurrence id it stands in for. */
export interface MergedCalendarEvent {
  /** The occurrence to render; a merged run uses its earliest occurrence. */
  event: CalendarEvent;
  /** Every occurrence id the bar covers, so selection and focus match any day. */
  occurrenceIds: string[];
}

/** The calendar and label a working-location run must share to merge. */
function workingLocationKey(event: CalendarEvent) {
  return `${event.calendar.id} ${event.title} ${event.location ?? ''}`;
}

function isMergeableWorkingLocation(event: CalendarEvent) {
  return (
    event.eventType === EventType.working_location &&
    event.allDay &&
    !event.isCancelled
  );
}

function singleton(event: CalendarEvent): MergedCalendarEvent {
  return { event, occurrenceIds: [event.id] };
}

/**
 * Collapses runs of consecutive all-day working-location occurrences from the
 * same calendar into a single spanning bar so they render linked, matching
 * Google Calendar. Google models working location as a separate per-weekday
 * recurring event, so a Mon–Fri "Office" arrives as five distinct one-day
 * occurrences that would otherwise draw five separate chips.
 *
 * A run collapses into its earliest occurrence with the end extended to cover
 * the run; every day's occurrence id is reported in `occurrenceIds` so click,
 * selection, and focus navigation resolve for any day the bar covers, even the
 * ones with no chip of their own. All-day bounds are RFC 5545 date strings
 * (`YYYY-MM-DD`, exclusive end), which compare chronologically as text.
 */
export function mergeWorkingLocationEvents(
  events: CalendarEvent[]
): MergedCalendarEvent[] {
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    if (!isMergeableWorkingLocation(event)) continue;
    const key = workingLocationKey(event);
    const bucket = groups.get(key);
    if (bucket) bucket.push(event);
    else groups.set(key, [event]);
  }
  if (groups.size === 0) return events.map(singleton);

  const passthrough = events
    .filter((event) => !isMergeableWorkingLocation(event))
    .map(singleton);
  const merged: MergedCalendarEvent[] = [];
  for (const bucket of groups.values()) {
    bucket.sort((a, b) =>
      a.start < b.start
        ? -1
        : a.start > b.start
          ? 1
          : a.end < b.end
            ? -1
            : a.end > b.end
              ? 1
              : 0
    );

    let representative = bucket[0];
    let runEnd = representative.end;
    let occurrenceIds = [representative.id];
    const flush = () => {
      merged.push({
        event:
          occurrenceIds.length > 1
            ? { ...representative, end: runEnd }
            : representative,
        occurrenceIds,
      });
    };
    for (let i = 1; i < bucket.length; i++) {
      const next = bucket[i];
      if (next.start <= runEnd) {
        if (next.end > runEnd) runEnd = next.end;
        occurrenceIds.push(next.id);
      } else {
        flush();
        representative = next;
        runEnd = next.end;
        occurrenceIds = [next.id];
      }
    }
    flush();
  }

  return [...passthrough, ...merged];
}
