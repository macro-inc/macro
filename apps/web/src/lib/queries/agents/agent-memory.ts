import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { agentKeys } from './keys';

function agentMemoryQueryOptions(agentId: string | undefined) {
  return queryOptions({
    queryKey: agentKeys.memory(agentId ?? '').queryKey,
    enabled: agentId !== undefined,
    queryFn: () =>
      throwOnErr(() => storageServiceClient.getAgentMemory(agentId ?? '')),
  });
}

/**
 * What the agent remembers across its conversations, and the revision an
 * edit of it is made against.
 */
export function useAgentMemoryQuery(agentId: Accessor<string | undefined>) {
  return useQuery(() => agentMemoryQueryOptions(agentId()));
}

/**
 * Replaces the agent's memory, whole. Fails without changing it when the
 * memory moved on from `revision`, as when the agent remembered something
 * while it was being edited.
 */
export async function saveAgentMemory(
  agentId: string,
  revision: number,
  content: string
) {
  const memory = await throwOnErr(() =>
    storageServiceClient.updateAgentMemory({
      agent_id: agentId,
      revision,
      content,
    })
  );
  queryClient.setQueryData(agentKeys.memory(agentId).queryKey, memory);
}
