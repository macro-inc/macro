import { createQueryKeys } from '@lukemorales/query-key-factory';
// This namespace is deliberately absent from persisted query scopes. Pairing data
// exists only in the focused flow's memory and is removed when it closes.
export const linkedKeys = createQueryKeys('whatsapp-linked', {
  configuration: null,
  account: (user: string) => [user],
  pairing: (user: string, id: string) => [user, id],
  groups: (user: string) => [user],
  channel: (id: string) => [id],
  delivery: (id: string, messages: string[]) => [id, messages],
});
