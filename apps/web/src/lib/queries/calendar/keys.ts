import { createQueryKeys } from '@lukemorales/query-key-factory';

export interface CalendarOccurrenceQueryRange {
  start: string;
  end: string;
  startDate: string;
  endDate: string;
}

/** Mutation key shared by the RSVP mutation and the websocket refresh
 * handler, which must not refetch occurrences over in-flight optimistic
 * RSVP state. */
export const RSVP_MUTATION_KEY = ['calendar', 'rsvp'] as const;

/** Saves of which calendars count as busy; a refresh waits for them to settle. */
export const AVAILABILITY_CALENDAR_MUTATION_KEY = [
  'calendar',
  'set-availability-calendar',
] as const;

/**
 * Cache-backed reads nest under the REST keys, so invalidations and the
 * optimistic patches applied to `occurrences._def` reach both.
 */
export const calendarKeys = createQueryKeys('calendar', {
  // Keyed by account, so a persisted list is only restored for its owner.
  visibleCalendars: (userId: string | undefined) => ({
    queryKey: [userId],
    contextQueries: { graphql: null },
  }),
  invitations: (threadId: string) => ({
    queryKey: [threadId],
  }),
  occurrences: (
    userId: string,
    range: CalendarOccurrenceQueryRange | undefined
  ) => ({
    queryKey: [userId, range],
    contextQueries: { graphql: null },
  }),
  teamOutOfOffice: (
    userId: string,
    range: CalendarOccurrenceQueryRange | undefined,
    teamId?: string
  ) => ({
    queryKey: [userId, range, teamId],
  }),
  mentionPreview: (eventId: string, occurrenceKey: string | undefined) => ({
    queryKey: [eventId, occurrenceKey],
  }),
  searchPreviews: (
    items: readonly { eventId: string; occurrenceKey?: string | null }[]
  ) => ({ queryKey: [items] }),
  joinRequests: (eventId: string) => ({
    queryKey: [eventId],
  }),
  availabilityCalendars: (userId: string) => ({
    queryKey: [userId],
  }),
});
