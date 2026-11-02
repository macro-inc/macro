import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { authServiceClient } from '@service-auth/client';
import type { AgentApiKey } from '@service-auth/generated/schemas/agentApiKey';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { agentKeys } from './keys';

function agentApiKeyQueryOptions(agentId: string | undefined) {
  return queryOptions({
    queryKey: agentKeys.apiKey(agentId ?? '').queryKey,
    enabled: agentId !== undefined,
    queryFn: () =>
      throwOnErr(() => authServiceClient.getAgentApiKey(agentId ?? '')),
  });
}

/**
 * The agent's own API key, if it has one, and whether its owner's plan lets
 * it run on one. The response never carries a key.
 */
export function useAgentApiKeyQuery(agentId: Accessor<string | undefined>) {
  return useQuery(() => agentApiKeyQueryOptions(agentId()));
}

function store(agentId: string, key: AgentApiKey) {
  queryClient.setQueryData(agentKeys.apiKey(agentId).queryKey, key);
}

/** Stores the agent's key, for its model's provider, replacing any. */
export async function saveAgentApiKey(agentId: string, apiKey: string) {
  store(
    agentId,
    await throwOnErr(() => authServiceClient.putAgentApiKey(agentId, apiKey))
  );
}

/** Forgets the agent's key. Does not revoke it at the provider. */
export async function removeAgentApiKey(agentId: string) {
  store(
    agentId,
    await throwOnErr(() => authServiceClient.deleteAgentApiKey(agentId))
  );
}
