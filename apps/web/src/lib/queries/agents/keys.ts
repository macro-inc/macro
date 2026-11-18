import { createQueryKeys } from '@lukemorales/query-key-factory';

export const agentKeys = createQueryKeys('agents', {
  list: null,
  codingPreferences: null,
  autoArchivePreferences: null,
  apiKey: (agentId: string) => [agentId],
});
