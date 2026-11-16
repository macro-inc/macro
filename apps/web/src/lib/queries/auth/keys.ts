import { createQueryKeys } from '@lukemorales/query-key-factory';

export const authKeys = createQueryKeys('auth', {
  aiBillingPlans: null,
  aiBillingSummary: null,
  subscriptionStatus: null,
  trialEligibility: null,
  codexStatus: null,
  codexEnvironments: null,
  codexLogin: (attemptId: string) => ({ queryKey: [attemptId] }),
  cursorApiKeyStatus: null,
  cursorModels: null,
  githubLinkStatus: null,
  emailConnectionProviders: null,
  userInfo: null,
  userLanguage: null,
  userName: (
    viewerId: string,
    session: number,
    generation: number,
    userId: string
  ) => ({
    queryKey: [viewerId, session, generation, userId],
  }),
  userNameSelf: (viewerId: string, session: number) => [viewerId, session],
  userQuota: null,
});
