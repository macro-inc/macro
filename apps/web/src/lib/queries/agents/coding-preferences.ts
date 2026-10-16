import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  agentHarnessServiceClient,
  type CodingPreferencesBody,
} from '@service-agent-harness/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { agentKeys } from './keys';

/** What the user's new coding sessions are told to do beyond their assignment. */
export function useCodingPreferencesQuery() {
  return useQuery(() => ({
    queryKey: agentKeys.codingPreferences.queryKey,
    queryFn: async () =>
      throwOnErr(
        async () => await agentHarnessServiceClient.getCodingPreferences()
      ),
  }));
}

/** Replaces the preferences optimistically and rolls back if the save fails. */
export function useSetCodingPreferencesMutation() {
  return useMutation(() => ({
    mutationFn: async (preferences: CodingPreferencesBody) =>
      throwOnErr(
        async () =>
          await agentHarnessServiceClient.setCodingPreferences(preferences)
      ),
    onMutate: async (preferences: CodingPreferencesBody) => {
      await queryClient.cancelQueries({
        queryKey: agentKeys.codingPreferences.queryKey,
      });
      const previous = queryClient.getQueryData<CodingPreferencesBody>(
        agentKeys.codingPreferences.queryKey
      );
      queryClient.setQueryData<CodingPreferencesBody>(
        agentKeys.codingPreferences.queryKey,
        preferences
      );
      return { previous };
    },
    onError: (_error, _preferences, context) => {
      if (context?.previous === undefined) return;
      queryClient.setQueryData(
        agentKeys.codingPreferences.queryKey,
        context.previous
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: agentKeys.codingPreferences.queryKey,
      });
    },
  }));
}
