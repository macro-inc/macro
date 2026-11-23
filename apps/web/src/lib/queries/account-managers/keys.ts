import { createQueryKeys } from '@lukemorales/query-key-factory';

export const accountManagerKeys = createQueryKeys('accountManagers', {
  list: null,
  grant: (id: string) => [id],
});
