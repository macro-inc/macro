import { createQueryKeys } from '@lukemorales/query-key-factory';

export const systemStatusKeys = createQueryKeys('systemStatus', {
  current: null,
  history: null,
});
