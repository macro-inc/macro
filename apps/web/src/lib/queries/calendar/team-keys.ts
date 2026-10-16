import { createQueryKeys } from '@lukemorales/query-key-factory';

export interface CalendarTeamIdentity {
  userId: string;
  teamId: string;
}

/** Never normalized into the viewer's own-event GraphQL cache. */
export const calendarTeamKeys = createQueryKeys('calendar-team', {
  identity: (userId: string) => [userId],
  sharing: (identity: CalendarTeamIdentity | undefined) => [identity],
  availabilityCalendars: (identity: CalendarTeamIdentity | undefined) => [
    identity,
  ],
});

/** Saves of the viewer's own settings; a refresh waits for them to settle. */
export const calendarTeamMutationKeys = {
  sharing: ['calendar-team', 'set-sharing'] as const,
  availabilityCalendar: ['calendar-team', 'set-availability-calendar'] as const,
};
