import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { useQuery } from '@tanstack/solid-query';
import { agentRepositoryKeys } from './keys';

/**
 * The branches on one GitHub repository the signed-in user can start a
 * coding session from. The same listing the picker offers, authorized the
 * same way as an explicit `repoUrl` on create-session.
 *
 * Enabled only while a repository is selected: listing costs a GitHub call
 * per repository, and chat agents never ask.
 */
export function useAgentRepositoryBranchesQuery(
  repoUrl: () => string | undefined
) {
  return useQuery(() => {
    const url = repoUrl();
    return {
      queryKey: agentRepositoryKeys.branches(url ?? '').queryKey,
      queryFn: async () =>
        throwOnErr(() =>
          agentHarnessServiceClient.listRepositoryBranches(url ?? '')
        ),
      enabled: !!url,
      staleTime: 2 * 60 * 1000,
    };
  });
}
