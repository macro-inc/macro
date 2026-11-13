import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { SpendBucket } from '../generated/types';

export const agentPaneKeys = createQueryKeys('dynamicUiAgentPanes', {
  spend: (agentId: string, bucket: SpendBucket) => ({
    queryKey: [agentId, bucket],
  }),
  routines: (agentId: string) => ({ queryKey: [agentId] }),
});
