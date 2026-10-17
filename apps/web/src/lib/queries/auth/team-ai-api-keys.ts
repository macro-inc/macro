import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { authServiceClient } from '@service-auth/client';
import type { TeamAiApiKeys } from '@service-auth/generated/schemas/teamAiApiKeys';
import type { TeamAiProvider } from '@service-auth/generated/schemas/teamAiProvider';
import { useMutation, useQuery } from '@tanstack/solid-query';

import { authKeys } from './keys';

/**
 * Which providers the signed-in user's team has its own AI API key for.
 * The response never carries a key.
 */
export function useTeamAiApiKeysQuery(enabled: () => boolean = () => true) {
  return useQuery(() => ({
    queryKey: authKeys.teamAiApiKeys.queryKey,
    enabled: enabled(),
    queryFn: () => throwOnErr(() => authServiceClient.getTeamAiApiKeys()),
  }));
}

function storeKeys(keys: TeamAiApiKeys) {
  queryClient.setQueryData(authKeys.teamAiApiKeys.queryKey, keys);
}

/** Stores the team's key for a provider, replacing any. Team admins only. */
export function useSaveTeamAiApiKey() {
  return useMutation(() => ({
    mutationFn: (input: { provider: TeamAiProvider; apiKey: string }) =>
      throwOnErr(() =>
        authServiceClient.putTeamAiApiKey(input.provider, input.apiKey)
      ),
    onSuccess: storeKeys,
  }));
}

/**
 * Forgets the team's key for a provider. Team admins only. Does not revoke
 * the key at the provider; the settings copy says so.
 */
export function useRemoveTeamAiApiKey() {
  return useMutation(() => ({
    mutationFn: (provider: TeamAiProvider) =>
      throwOnErr(() => authServiceClient.deleteTeamAiApiKey(provider)),
    onSuccess: storeKeys,
  }));
}
