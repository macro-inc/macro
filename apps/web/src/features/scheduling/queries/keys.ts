import { createQueryKeys } from '@lukemorales/query-key-factory';
export const schedulingKeys = createQueryKeys('scheduling', {
  replacementSlots: (id: string, token: string, date: string) => [
    id,
    token,
    date,
  ],
  receipt: (id: string, token: string) => [id, token],
  settings: (scope: string) => [scope],
  bookings: (scope: string, from: string, to: string) => [scope, from, to],
  insights: (scope: string, from: string, to: string) => [scope, from, to],
  publicProfile: (id: string) => [id],
  slots: (profile: string, event: string, date: string) => [
    profile,
    event,
    date,
  ],
});
