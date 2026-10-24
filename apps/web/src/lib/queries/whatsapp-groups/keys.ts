import { createQueryKeys } from '@lukemorales/query-key-factory';

/** WhatsApp groups never share channel cache keys or persisted pairing state. */
export const whatsappGroupsKeys = createQueryKeys('whatsapp-groups', {
  list: (userId: string) => [userId],
  detail: (userId: string, groupId: string) => [userId, groupId],
  messages: (userId: string, groupId: string) => [userId, groupId],
  sends: (userId: string, groupId: string) => [userId, groupId],
});
