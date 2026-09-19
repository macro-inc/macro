import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { useQuery } from '@tanstack/solid-query';
import { agentRepositoryKeys } from './keys';

/**
 * The GitHub repositories the signed-in user can hand a coding session:
 * repositories under an installation they made, and organisation repositories
 * under an installation a team they belong to made. Teammates' personal
 * repositories are not included. The same list the create-session API
 * authorizes an explicit repository against, so what a picker offers is
 * exactly what a session may select.
 *
 * Kept fresh for a while: the harness caches the listing for ten minutes
 * itself, and installing the App somewhere new is rare and deliberate.
 */
export function useAgentRepositoriesQuery(enabled: () => boolean = () => true) {
  return useQuery(() => ({
    queryKey: agentRepositoryKeys.list.queryKey,
    queryFn: async () =>
      throwOnErr(() => agentHarnessServiceClient.listRepositories()),
    enabled: enabled(),
    staleTime: 5 * 60 * 1000,
  }));
}
