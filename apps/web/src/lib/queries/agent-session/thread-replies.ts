import { throwOnErr } from '@core/util/result';
import {
  agentHarnessServiceClient,
  type SessionThreadRepliesResponse,
} from '@service-agent-harness/client';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { agentSessionThreadRepliesKeys } from './keys';

function sessionThreadRepliesQueryOptions(sessionId: string | undefined) {
  return queryOptions({
    queryKey: agentSessionThreadRepliesKeys.detail(sessionId ?? '').queryKey,
    queryFn: async () =>
      throwOnErr(() =>
        agentHarnessServiceClient.getSessionThreadReplies(sessionId!)
      ),
    enabled: Boolean(sessionId),
    // Every message the session posted shares this record; someone else in
    // the thread may pause or resume it meanwhile.
    staleTime: 30_000,
  });
}

/** Whether the session answers unmentioned replies in its thread, and whether the caller may change that. */
export function useSessionThreadRepliesQuery(
  sessionId: Accessor<string | undefined>
) {
  return useQuery(() => sessionThreadRepliesQueryOptions(sessionId()));
}

type ThreadRepliesChange = { sessionId: string; paused: boolean };

/** Pauses or resumes the session's thread replies optimistically, rolling back if the save fails. */
export function useSetSessionThreadRepliesMutation() {
  return useMutation(() => ({
    mutationFn: async ({ sessionId, paused }: ThreadRepliesChange) =>
      throwOnErr(() =>
        agentHarnessServiceClient.setSessionThreadReplies(sessionId, {
          paused,
        })
      ),
    onMutate: async ({ sessionId, paused }: ThreadRepliesChange) => {
      const { queryKey } = agentSessionThreadRepliesKeys.detail(sessionId);
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<SessionThreadRepliesResponse>(queryKey);
      if (previous) {
        queryClient.setQueryData<SessionThreadRepliesResponse>(queryKey, {
          ...previous,
          paused,
        });
      }
      return { previous };
    },
    onError: (_error, { sessionId }, context) => {
      if (context?.previous === undefined) return;
      queryClient.setQueryData(
        agentSessionThreadRepliesKeys.detail(sessionId).queryKey,
        context.previous
      );
    },
    onSettled: (_data, _error, { sessionId }) => {
      queryClient.invalidateQueries({
        queryKey: agentSessionThreadRepliesKeys.detail(sessionId).queryKey,
      });
    },
  }));
}
