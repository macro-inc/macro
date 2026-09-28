import { createQueryKeys } from '@lukemorales/query-key-factory';

export const agentRepositoryKeys = createQueryKeys('agentRepositories', {
  list: null,
  branches: (repoUrl: string) => ({ queryKey: [repoUrl] }),
});
