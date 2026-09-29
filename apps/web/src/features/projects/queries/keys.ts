import { createQueryKeys } from '@lukemorales/query-key-factory';

export const projectKeys = createQueryKeys('initiatives', {
  create: null,
  createTask: (id: string) => [id],
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
