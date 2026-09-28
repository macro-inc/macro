import { useAgentRepositoriesQuery } from '@queries/agent-repositories/repositories';
import { type Accessor, createMemo } from 'solid-js';
import type { ReachableRepository } from '../core/repository';

export type ReachableRepositoriesSource = {
  /** Every repository the caller can hand a coder, as the harness sorted them. */
  repositories: Accessor<ReachableRepository[]>;
  /** The listing is on its first load. */
  loading: Accessor<boolean>;
  /** The listing failed; `retry` asks again. */
  error: Accessor<boolean>;
  retry: () => void;
};

/**
 * The composer's view of the caller's reachable repositories. Reads are
 * status-gated so a pending listing never suspends the composer around it.
 */
export function createReachableRepositories(
  enabled: Accessor<boolean>
): ReachableRepositoriesSource {
  const query = useAgentRepositoriesQuery(enabled);
  const repositories = createMemo<ReachableRepository[]>(() =>
    query.isSuccess
      ? query.data.repositories.map((repository) => ({
          url: repository.url,
          defaultBranch: repository.defaultBranch ?? undefined,
        }))
      : []
  );
  return {
    repositories,
    loading: () => query.isLoading,
    error: () => query.isError,
    retry: () => void query.refetch(),
  };
}
