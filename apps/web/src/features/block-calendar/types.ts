import type { CalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';

/** Stable identity used by the singleton calendar block. */
export const CALENDAR_BLOCK_ID = 'view';

/** Optional navigation parameters accepted by the singleton calendar block. */
export interface CalendarBlockProps {
  /** Canonical event to focus after loading `range`. */
  eventId?: string;
  /** Exact half-open occurrence API range used to locate `eventId`. */
  range?: CalendarOccurrenceQueryRange;
  /** Stable occurrence key, when the target is a recurring event instance. */
  occurrenceKey?: string;
}

/** A validated request to locate and focus one event occurrence. */
export interface CalendarBlockTargetRequest {
  eventId: string;
  range: CalendarOccurrenceQueryRange;
  occurrenceKey?: string;
  requestId: number;
  requestedAt: number;
}
