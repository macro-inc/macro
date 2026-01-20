import { createQueryKeys } from '@lukemorales/query-key-factory';

export const authKeys = createQueryKeys('auth', {
  userInfo: null,
  organization: null,
});
