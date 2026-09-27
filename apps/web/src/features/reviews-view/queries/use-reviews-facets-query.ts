import type { ListControlOption } from '@app/components/view-shell';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';

const REVIEWS_FACETS_STALE_TIME = 60_000;

/** A label among the visible pull requests, for the sidebar's Labels section. */
export type ReviewsLabel = {
  name: string;
  /** A CSS color, when GitHub reported one. */
  color?: string;
};

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
  const labels = (): ReviewsLabel[] =>
    (facets()?.labels ?? []).map((label) => ({
      name: label.name,
      color: label.color ? `#${label.color}` : undefined,
    }));

  return { query, repositories, authors, assignees, labels };
}
