import { createQueryKeys } from '@lukemorales/query-key-factory';

export const changesKeys = createQueryKeys('agent-changes', {
  pullRequestStats: (githubKey: string, captureId: string) => ({
    queryKey: [githubKey, captureId],
  }),
});
