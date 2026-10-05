import { createQueryKeys } from '@lukemorales/query-key-factory';

export const projectKeys = createQueryKeys('initiatives', {
  detail: (userId: string | undefined, id: string) => ({
    queryKey: [userId, id],
  }),
});
