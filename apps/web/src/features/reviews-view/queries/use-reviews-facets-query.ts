import type { ListControlOption } from '@app/components/view-shell';
import { throwOnErr } from '@core/util/result';
import type { GithubPullRequestLabel } from '@entity/types/entity';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';

const REVIEWS_FACETS_STALE_TIME = 60_000;

type UserFacet = { githubUserId: string; login?: string | null };

const userOption = (user: UserFacet): ListControlOption<string> => ({
  id: user.githubUserId,
  label: user.login ?? user.githubUserId,
});

/**
 * Filter options across every pull request visible to the viewer and their
 * team, not only the loaded pages. Repository, author, and assignee option ids
 * are the numeric GitHub ids the backend filters match; label ids are names.
 */
export function useReviewsFacetsQuery() {
  const query = useQuery(() => ({
    queryKey: ['reviews', 'githubPullRequestFacets'] as const,
    queryFn: () =>
      throwOnErr(() => storageServiceClient.getGithubPullRequestFacets()),
    staleTime: REVIEWS_FACETS_STALE_TIME,
  }));
  const facets = () => (query.isSuccess ? query.data : undefined);

  const repositories = (): ListControlOption<string>[] =>
    (facets()?.repositories ?? []).map((repository) => ({
      id: repository.repositoryId,
      label: repository.repository,
    }));
  const authors = (): ListControlOption<string>[] =>
    (facets()?.authors ?? []).map(userOption);
  const assignees = (): ListControlOption<string>[] =>
    (facets()?.assignees ?? []).map(userOption);
  const labels = (): GithubPullRequestLabel[] => facets()?.labels ?? [];

  return { query, repositories, authors, assignees, labels };
}
