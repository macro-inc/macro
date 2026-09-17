import { throwOnErr } from '@core/util/result';
import { claudeAuthClient } from '@service-agent-harness/claude-auth';
import { useQuery, useQueryClient } from '@tanstack/solid-query';
import type { ClaudeConnectionSource } from '../../../features/claude-connection/core/connection';
import { claudeAuthKeys } from './keys';

/** Only safe status is cached. One-time codes never enter a mutation cache. */
export function useClaudeConnectionSource(
  owner: () => string | undefined
): ClaudeConnectionSource {
  const client = useQueryClient();
  const query = useQuery(() => ({
    queryKey: claudeAuthKeys.status(owner()).queryKey,
    queryFn: ({ signal }) => throwOnErr(() => claudeAuthClient.status(signal)),
    enabled: !!owner(),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  }));
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: claudeAuthKeys._def }),
      client.invalidateQueries({
        queryKey: ['agent-models', 'load', 'claude-cloud'],
      }),
    ]);
  };
  return {
    status: () => (query.isSuccess ? query.data : undefined),
    failed: () => query.isError,
    begin: () => throwOnErr(() => claudeAuthClient.begin()),
    complete: async (attemptId, code) => {
      await throwOnErr(() => claudeAuthClient.complete(attemptId, code));
      await refresh();
    },
    disconnect: async () => {
      await throwOnErr(() => claudeAuthClient.disconnect());
      await refresh();
    },
    refresh,
  };
}
