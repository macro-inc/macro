import { createQueryKeys } from '@lukemorales/query-key-factory';

export const agentChangesKeys = createQueryKeys('agent-changes', {
  pullRequestStats: (githubKey: string, captureId: string) => ({
    queryKey: [githubKey, captureId],
  }),
});
