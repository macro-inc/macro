import { useAgentRepositoriesQuery } from '@queries/agent-repositories/repositories';
import type { Accessor } from 'solid-js';
import { repositoryLabel } from '../../agents-view/core/repository';
import type { GithubRepositoryOptions } from '../core/routine-triggers';

/**
 * The repositories Macro's GitHub app reaches for the user, as `owner/name`:
 * the same listing a coding session picks from. Status-gated, so a pending
 * listing never suspends the trigger panel.
 */
export function createGithubRepositoryOptions(
  enabled: Accessor<boolean>
): Accessor<GithubRepositoryOptions> {
  const query = useAgentRepositoriesQuery(enabled);
  return () => ({
    names: query.isSuccess
      ? query.data.repositories.map((repository) =>
          repositoryLabel(repository.url)
        )
      : [],
    loading: query.isLoading,
    error: query.isError,
  });
}
