import { useAgentRepositoryBranchesQuery } from '@queries/agent-repositories/branches';
import { type Accessor, createMemo } from 'solid-js';

export type RepositoryBranchesSource = {
  /** Branch names on the selected repository, as GitHub listed them. */
  branches: Accessor<string[]>;
  /** The listing is on its first load. */
  loading: Accessor<boolean>;
  /** The listing failed; `retry` asks again. */
  error: Accessor<boolean>;
  retry: () => void;
};

/**
 * The composer's view of one repository's branches. Reads are status-gated
 * so a pending listing never suspends the composer around it.
 */
export function createRepositoryBranches(
  repoUrl: Accessor<string | undefined>
): RepositoryBranchesSource {
  const query = useAgentRepositoryBranchesQuery(repoUrl);
  const branches = createMemo<string[]>(() =>
    query.isSuccess ? query.data.branches : []
  );
  return {
    branches,
    loading: () => query.isLoading,
    error: () => query.isError,
    retry: () => void query.refetch(),
  };
}
