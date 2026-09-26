import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { ProjectFilters } from '../core/project';

export const projectKeys = createQueryKeys('initiatives', {
  command: (userId: string | undefined, query: string) => ({
    queryKey: [userId, query],
  }),
  identity: (userId: string | undefined, id: string) => ({
    queryKey: [userId, id],
  }),
  list: (userId: string | undefined, filters: ProjectFilters) => ({
    queryKey: [userId, filters],
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
