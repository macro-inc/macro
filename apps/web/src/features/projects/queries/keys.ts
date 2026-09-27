import { createQueryKeys } from '@lukemorales/query-key-factory';

export const projectKeys = createQueryKeys('initiatives', {
  identity: (userId: string | undefined, id: string) => ({
    queryKey: [userId, id],
  }),
  detail: (userId: string | undefined, id: string) => ({
    queryKey: [userId, id],
  }),
  tasks: (userId: string | undefined, id: string) => ({
    queryKey: [userId, id],
  }),
  taskReferences: (userId: string | undefined, ids: readonly string[]) => ({
    queryKey: [userId, [...ids].sort()],
  }),
});
