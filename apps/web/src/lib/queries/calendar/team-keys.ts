import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { CalendarOccurrenceQueryRange } from './keys';

export interface CalendarTeamIdentity {
  userId: string;
  teamId: string;
}

/** Never normalized into the viewer's own-event GraphQL cache. */
export const calendarTeamKeys = createQueryKeys('calendar-team', {
  identity: (userId: string) => [userId],
  sharing: (identity: CalendarTeamIdentity | undefined) => [identity],
  members: (identity: CalendarTeamIdentity | undefined) => [identity],
  availabilityCalendars: (identity: CalendarTeamIdentity | undefined) => [
    identity,
  ],
  events: (
    identity: CalendarTeamIdentity | undefined,
    range: CalendarOccurrenceQueryRange | undefined
  ) => [identity, range],
});
