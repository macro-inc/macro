import { createQueryKeys } from '@lukemorales/query-key-factory';

export const historyKeys = createQueryKeys('history', {
  all: null,
  graphqlList: null,
  list: null,
});
