import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type { GithubPullRequestNumber } from '@service-auth/generated/schemas';
import { useQueries } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import type { PullRequestMergeability } from '../core/reviews-board';

/** The mergeability route answers at most this many pull requests at once. */
const MERGEABILITY_CHUNK_SIZE = 100;
/** GitHub recomputes mergeability when either branch moves. */
const MERGEABILITY_STALE_TIME = 60_000;

const mergeabilityKey = (pullRequest: GithubPullRequestNumber) =>
  `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`.toLowerCase();

const reviewsMergeabilityQueryOptions = (
  pullRequests: readonly GithubPullRequestNumber[]
) => ({
  queryKey: [
    'reviews',
    'mergeability',
    pullRequests.map(mergeabilityKey),
  ] as const,
  queryFn: async () => {
    const response = await throwOnErr(() =>
      authServiceClient.getGithubPullRequestMergeability({
        pullRequests: [...pullRequests],
      })
    );
    return response.pullRequests.map(
      (entry) =>
        [mergeabilityKey(entry), entry.mergeability] as [
          string,
          PullRequestMergeability,
        ]
    );
  },
  staleTime: MERGEABILITY_STALE_TIME,
});

/**
 * Whether GitHub can merge each open pull request, read live because
 * conflicts appear whenever the base moves, without an event on the pull
 * request itself. Pull requests the viewer cannot see stay unknown.
 */
export function useReviewsMergeabilityQuery(
  pullRequests: Accessor<readonly GithubPullRequestNumber[]>,
  enabled: Accessor<boolean>
) {
  const chunks = createMemo(() => {
    const all = pullRequests();
    const result: GithubPullRequestNumber[][] = [];
    for (let index = 0; index < all.length; index += MERGEABILITY_CHUNK_SIZE)
      result.push(
        all
          .slice(index, index + MERGEABILITY_CHUNK_SIZE)
          .map(({ owner, repo, number }) => ({ owner, repo, number }))
      );
    return result;
  });
  const queries = useQueries(() => ({
    queries: chunks().map((chunk) => ({
      ...reviewsMergeabilityQueryOptions(chunk),
      enabled: enabled(),
    })),
  }));
  const byKey = createMemo(() => {
    const result = new Map<string, PullRequestMergeability>();
    for (const query of queries) {
      if (!query.isSuccess) continue;
      for (const [key, value] of query.data) result.set(key, value);
    }
    return result;
  });

  return {
    mergeability: (pullRequest: GithubPullRequestNumber) =>
      byKey().get(mergeabilityKey(pullRequest)),
    isError: () => queries.some((query) => query.isError),
  };
}
