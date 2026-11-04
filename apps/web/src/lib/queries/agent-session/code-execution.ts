import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { agentCodeExecutionKeys } from './keys';

/** Poll while execution is running, including the brief create-to-persist race. */
export function useAgentCodeExecutionQuery(
  sessionId: Accessor<string>,
  executionId: Accessor<string | undefined>
) {
  return useQuery(() =>
    agentCodeExecutionQueryOptions(sessionId(), executionId())
  );
}

export function agentCodeExecutionQueryOptions(
  session: string,
  execution: string | undefined
) {
  return queryOptions({
    queryKey: agentCodeExecutionKeys.detail(session, execution ?? '').queryKey,
    queryFn: () =>
      throwOnErr(() =>
        agentHarnessServiceClient.getCodeExecution(session, execution!)
      ),
    enabled: Boolean(session && execution),
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: (query) =>
      (!query.state.data || query.state.data.status === 'running') &&
      query.state.dataUpdateCount + query.state.errorUpdateCount < 40
        ? 1000
        : false,
  });
}
