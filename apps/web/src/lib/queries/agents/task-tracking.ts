import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  agentHarnessServiceClient,
  type TaskTrackingBody,
} from '@service-agent-harness/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { agentKeys } from './keys';

/** Whether the user's new coding sessions track their work with tasks. */
export function useTaskTrackingQuery() {
  return useQuery(() => ({
    queryKey: agentKeys.taskTracking.queryKey,
    queryFn: async () =>
      throwOnErr(async () => await agentHarnessServiceClient.getTaskTracking()),
  }));
}

/** Flips the setting optimistically and rolls back if the save fails. */
export function useSetTaskTrackingMutation() {
  return useMutation(() => ({
    mutationFn: async (enabled: boolean) =>
      throwOnErr(
        async () => await agentHarnessServiceClient.setTaskTracking(enabled)
      ),
    onMutate: async (enabled: boolean) => {
      await queryClient.cancelQueries({
        queryKey: agentKeys.taskTracking.queryKey,
      });
      const previous = queryClient.getQueryData<TaskTrackingBody>(
        agentKeys.taskTracking.queryKey
      );
      queryClient.setQueryData<TaskTrackingBody>(
        agentKeys.taskTracking.queryKey,
        { enabled }
      );
      return { previous };
    },
    onError: (_error, _enabled, context) => {
      if (context?.previous === undefined) return;
      queryClient.setQueryData(
        agentKeys.taskTracking.queryKey,
        context.previous
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: agentKeys.taskTracking.queryKey,
      });
    },
  }));
}
