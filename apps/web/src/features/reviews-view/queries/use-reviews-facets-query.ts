import type { ListControlOption } from '@app/components/view-shell';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

const REVIEWS_FACETS_STALE_TIME = 60_000;

/**
 * Repository and author filter options across every pull request visible to
 * the viewer and their team, not only the loaded pages. Option ids are the
 * numeric GitHub ids the backend filters match.
 */
export function useReviewsFacetsQuery(enabled: Accessor<boolean>) {
  const query = useQuery(() => ({
    queryKey: ['reviews', 'githubPullRequestFacets'] as const,
    queryFn: () =>
      throwOnErr(() => storageServiceClient.getGithubPullRequestFacets()),
    enabled: enabled(),
    staleTime: REVIEWS_FACETS_STALE_TIME,
  }));
  const facets = () => (query.isSuccess ? query.data : undefined);

  const repositories = (): ListControlOption<string>[] =>
    (facets()?.repositories ?? []).map((repository) => ({
      id: repository.repositoryId,
      label: repository.repository,
    }));
  const authors = (): ListControlOption<string>[] =>
    (facets()?.authors ?? []).map((author) => ({
      id: author.githubUserId,
      label: author.login ?? author.githubUserId,
    }));

  return { query, repositories, authors };
}
