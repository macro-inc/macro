import { createQueryKeys } from '@lukemorales/query-key-factory';

export interface CalendarOccurrenceQueryRange {
  start: string;
  end: string;
  startDate: string;
  endDate: string;
}

/**
 * Calendar reads stay in memory for the session, so a period reopens without
 * a read. The native apps also persist them, and a persisted entry is dropped
 * with its query; the default ten minutes would leave a cold start nothing.
 */
export const CALENDAR_GC_TIME = 24 * 60 * 60_000;

/** Mutation key shared by the RSVP mutation and the websocket refresh
 * handler, which must not refetch occurrences over in-flight optimistic
 * RSVP state. */
export const RSVP_MUTATION_KEY = ['calendar', 'rsvp'] as const;

/**
 * Cache-backed reads nest under the REST keys, so invalidations and the
 * optimistic patches applied to `occurrences._def` reach both.
 */
export const calendarKeys = createQueryKeys('calendar', {
  visibleCalendars: {
    queryKey: null,
    contextQueries: { graphql: null },
  },
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
});
