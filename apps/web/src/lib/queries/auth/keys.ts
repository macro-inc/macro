import { createQueryKeys } from '@lukemorales/query-key-factory';

export const authKeys = createQueryKeys('auth', {
  cursorApiKeyStatus: null,
  cursorModels: null,
  githubLinkStatus: null,
  userInfo: null,
  userName: (userId: string) => ({
    queryKey: [userId],
  }),
  userNameSelf: null,
  userQuota: null,
});
