import { createQueryKeys } from '@lukemorales/query-key-factory';

/** External chats never share channel cache keys or persisted pairing state. */
export const externalChatsKeys = createQueryKeys('external-chats', {
  list: (userId: string) => [userId],
  detail: (userId: string, chatId: string) => [userId, chatId],
  messages: (userId: string, chatId: string) => [userId, chatId],
  delivery: (userId: string, chatId: string) => ({
    queryKey: [userId, chatId],
    contextQueries: {
      sends: (sendIds: string[]) => ({ queryKey: [sendIds] }),
    },
  }),
});
