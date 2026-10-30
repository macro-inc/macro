import { throwOnErr } from '@core/util/result';
import { agentSessionAutoArchiveKeys } from '@queries/agent-session/keys';
import { queryClient } from '@queries/client';
import {
  type AutoArchivePreferencesBody,
  agentHarnessServiceClient,
} from '@service-agent-harness/client';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { agentKeys } from './keys';

const autoArchivePreferencesQueryOptions = queryOptions({
  queryKey: agentKeys.autoArchivePreferences.queryKey,
  queryFn: async () =>
    throwOnErr(
      async () => await agentHarnessServiceClient.getAutoArchivePreferences()
    ),
});

/** When the user's sessions archive themselves unless a session says otherwise. */
export function useAutoArchivePreferencesQuery() {
  return useQuery(() => autoArchivePreferencesQueryOptions);
}

/**
 * Replaces the defaults optimistically and rolls back if the save fails. Each
 * session's auto-archive state embeds the defaults, so those refetch too.
 */
export function useSetAutoArchivePreferencesMutation() {
  return useMutation(() => ({
    mutationFn: async (preferences: AutoArchivePreferencesBody) =>
      throwOnErr(
        async () =>
          await agentHarnessServiceClient.setAutoArchivePreferences(preferences)
      ),
    onMutate: async (preferences: AutoArchivePreferencesBody) => {
      await queryClient.cancelQueries({
        queryKey: agentKeys.autoArchivePreferences.queryKey,
      });
      const previous = queryClient.getQueryData<AutoArchivePreferencesBody>(
        agentKeys.autoArchivePreferences.queryKey
      );
      queryClient.setQueryData<AutoArchivePreferencesBody>(
        agentKeys.autoArchivePreferences.queryKey,
        preferences
      );
      return { previous };
    },
    onError: (_error, _preferences, context) => {
      if (context?.previous === undefined) return;
      queryClient.setQueryData(
        agentKeys.autoArchivePreferences.queryKey,
        context.previous
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: agentKeys.autoArchivePreferences.queryKey,
      });
      queryClient.invalidateQueries({
        queryKey: agentSessionAutoArchiveKeys._def,
      });
    },
  }));
}
