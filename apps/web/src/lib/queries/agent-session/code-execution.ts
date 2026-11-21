import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { agentCodeExecutionKeys } from './keys';

/** How long a running job's record may fail to load before polling stops. */
const JOB_POLL_FAILURE_LIMIT_MS = 30_000;

/** Poll while execution is running, including the brief create-to-persist race, and while a background job runs. */
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
    refetchInterval: (query) => {
      const data = query.state.data;
      // A background job runs for up to ten minutes; it is polled until it
      // settles, and its log frame refetches it at once when it does.
      // Polling outlasts brief failures and stops once loads have failed
      // for half a minute since the last one that worked.
      if (data?.job && data.status === 'running') {
        const failingFor =
          query.state.status === 'error'
            ? query.state.errorUpdatedAt - query.state.dataUpdatedAt
            : 0;
        return failingFor < JOB_POLL_FAILURE_LIMIT_MS ? 2000 : false;
      }
      return (!data || data.status === 'running') &&
        query.state.dataUpdateCount + query.state.errorUpdateCount < 40
        ? 1000
        : false;
    },
  });
}

type CancelJob = { sessionId: string; executionId: string };

function cancelJob({ sessionId, executionId }: CancelJob) {
  return throwOnErr(() =>
    agentHarnessServiceClient.cancelCodeExecutionJob(sessionId, executionId)
  );
}

function refetchJob(
  client: QueryClient,
  { sessionId, executionId }: CancelJob
) {
  return client.invalidateQueries({
    queryKey: agentCodeExecutionKeys.detail(sessionId, executionId).queryKey,
  });
}

/**
 * Stop a background job. It settles as cancelled within about a second; its
 * log frame and the record's polling show that, so this only refetches.
 */
export function useCancelBackgroundJobMutation() {
  const client = useQueryClient();
  return useMutation(() => ({
    retry: false,
    mutationFn: cancelJob,
    onSettled: (_data, _error, job) => refetchJob(client, job),
  }));
}

/** Refetch a job's record now, when its log frame says it moved. */
export function refetchBackgroundJob(client: QueryClient, job: CancelJob) {
  return refetchJob(client, job);
}
