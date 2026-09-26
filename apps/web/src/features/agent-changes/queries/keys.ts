import { createQueryKeys } from '@lukemorales/query-key-factory';

export const agentChangesKeys = createQueryKeys('agent-changes', {
  pullRequestChanges: (githubKey: string) => ({ queryKey: [githubKey] }),
  pullRequestStats: (githubKey: string, captureId: string) => ({
    queryKey: [githubKey, captureId],
  }),
});
