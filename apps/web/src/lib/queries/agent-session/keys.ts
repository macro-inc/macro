import { createQueryKeys } from '@lukemorales/query-key-factory';

export const agentSessionKeys = createQueryKeys('agentSessionMentions', {
  preview: (id: string, graphql: boolean) => ({ queryKey: [id, graphql] }),
});
