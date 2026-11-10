import { createQueryKeys } from '@lukemorales/query-key-factory';

export const ideasKeys = createQueryKeys('ideas', {
  feed: (userId: string) => [userId],
});
