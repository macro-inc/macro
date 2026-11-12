import { createQueryKeys } from '@lukemorales/query-key-factory';

export const suggestionsKeys = createQueryKeys('suggestions', {
  feed: (userId: string) => [userId],
});
