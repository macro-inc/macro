import { createQueryKeys } from '@lukemorales/query-key-factory';

export const connectorKeys = createQueryKeys('connectors', {
  list: null,
  catalog: (search: string) => [search],
  catalogIcons: null,
});
