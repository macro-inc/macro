import { createQueryKeys } from '@lukemorales/query-key-factory';

export const suggestionsKeys = createQueryKeys('suggestions', {
  feed: (userId: string) => [userId],
  generation: (userId: string) => [userId],
  top: (userId: string, limit: number) => [userId, limit],
});
