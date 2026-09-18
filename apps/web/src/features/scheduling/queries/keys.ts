import { createQueryKeys } from '@lukemorales/query-key-factory';
export const schedulingKeys = createQueryKeys('scheduling', {
  receipt: (id: string, token: string) => [id, token],
  settings: (scope: string) => [scope],
  bookings: (scope: string) => [scope],
  insights: (scope: string, from: string, to: string) => [scope, from, to],
  publicProfile: (id: string) => [id],
  slots: (profile: string, event: string, date: string) => [
    profile,
    event,
    date,
  ],
});
