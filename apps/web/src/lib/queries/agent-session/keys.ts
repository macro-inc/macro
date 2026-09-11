import { createQueryKeys } from '@lukemorales/query-key-factory';

export const agentSessionKeys = createQueryKeys('agentSessionMentions', {
  recent: (graphql: boolean) => ({ queryKey: [graphql] }),
  preview: (id: string, graphql: boolean) => ({ queryKey: [id, graphql] }),
});
