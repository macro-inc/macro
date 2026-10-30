import { throwOnErr } from '@core/util/result';
import {
  type AutoArchiveOverridesBody,
  agentHarnessServiceClient,
  type SessionAutoArchiveResponse,
} from '@service-agent-harness/client';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { agentSessionAutoArchiveKeys } from './keys';

function sessionAutoArchiveQueryOptions(sessionId: string | undefined) {
  return queryOptions({
    queryKey: agentSessionAutoArchiveKeys.detail(sessionId ?? '').queryKey,
    queryFn: async () =>
      throwOnErr(() =>
        agentHarnessServiceClient.getSessionAutoArchive(sessionId!)
      ),
    enabled: Boolean(sessionId),
    // A trigger or a restore can change the record while it sits in the cache.
    staleTime: 0,
  });
}

/** The session's auto-archive choices, its owner's defaults, and the archive a trigger made. */
export function useSessionAutoArchiveQuery(
  sessionId: Accessor<string | undefined>
) {
  return useQuery(() => sessionAutoArchiveQueryOptions(sessionId()));
}

type SessionOverridesChange = {
  sessionId: string;
  overrides: AutoArchiveOverridesBody;
};

/** Replaces the session's choices optimistically and rolls back if the save fails. */
export function useSetSessionAutoArchiveMutation() {
  return useMutation(() => ({
    mutationFn: async ({ sessionId, overrides }: SessionOverridesChange) =>
      throwOnErr(() =>
        agentHarnessServiceClient.setSessionAutoArchive(sessionId, overrides)
      ),
    onMutate: async ({ sessionId, overrides }: SessionOverridesChange) => {
      const { queryKey } = agentSessionAutoArchiveKeys.detail(sessionId);
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<SessionAutoArchiveResponse>(queryKey);
      if (previous) {
        queryClient.setQueryData<SessionAutoArchiveResponse>(queryKey, {
          ...previous,
          overrides,
        });
      }
      return { previous };
    },
    onError: (_error, { sessionId }, context) => {
      if (context?.previous === undefined) return;
      queryClient.setQueryData(
        agentSessionAutoArchiveKeys.detail(sessionId).queryKey,
        context.previous
      );
    },
    onSettled: (_data, _error, { sessionId }) => {
      queryClient.invalidateQueries({
        queryKey: agentSessionAutoArchiveKeys.detail(sessionId).queryKey,
      });
    },
  }));
}
