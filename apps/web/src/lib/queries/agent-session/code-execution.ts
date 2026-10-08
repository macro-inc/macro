import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { agentCodeExecutionKeys } from './keys';

/** Fetch after the outer call ends. A stopped request may still be saving cleanup. */
export function useAgentCodeExecutionQuery(
  sessionId: Accessor<string>,
  executionId: Accessor<string | undefined>
) {
  return useQuery(() => {
    const session = sessionId();
    const execution = executionId();
    return {
      queryKey: agentCodeExecutionKeys.detail(session, execution ?? '')
        .queryKey,
      queryFn: () =>
        throwOnErr(() =>
          agentHarnessServiceClient.getCodeExecution(session, execution!)
        ),
      enabled: Boolean(session && execution),
      retry: 1,
      staleTime: Number.POSITIVE_INFINITY,
      refetchInterval: (query) =>
        query.state.data?.status === 'running' &&
        query.state.dataUpdateCount < 40
          ? 1000
          : false,
    };
  });
}
