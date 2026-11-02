import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import { type QueryState, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import {
  parseGithubPrUrl,
  prDisplayName,
  prHtmlUrl,
  toGithubKey,
} from '../../block-pr/util/prKey';
import { changesKeys } from './keys';

const REFETCH_MS = 30_000;
const FAILING_REFETCH_MS = 5 * 60_000;

export function pullRequestStatsQueryOptions(
  url: string | undefined,
  captureId?: string
) {
  const reference = url ? parseGithubPrUrl(url) : null;
  const githubKey = reference ? toGithubKey(reference) : '';
  return {
    queryKey: changesKeys.pullRequestStats(githubKey, captureId ?? '').queryKey,
    enabled: reference !== null,
    queryFn: async () => {
      if (!reference) return null;
      // The auth-service proxy calls GitHub with the viewer's linked account.
      const response = await throwOnErr(() =>
        authServiceClient.enrichGithubPullRequests({
          pullRequests: [
            {
              ...reference,
              githubKey,
              displayName: prDisplayName(reference),
              url: prHtmlUrl(reference),
            },
          ],
        })
      );
      const pr = response.pullRequests.find((pr) => pr.githubKey === githubKey);
      if (!pr) return null;
      // A title can be known even when GitHub totals are unavailable.
      return {
        title: pr.name ?? undefined,
        counts:
          pr.additions != null && pr.deletions != null
            ? { additions: pr.additions, deletions: pr.deletions }
            : undefined,
      };
    },
    staleTime: 30_000,
    // GitHub answers unchanged pull requests without spending quota, but a
    // failing or throttled GitHub is asked again only every few minutes.
    refetchInterval: (query: { state: Pick<QueryState, 'status'> }) =>
      query.state.status === 'error' ? FAILING_REFETCH_MS : REFETCH_MS,
    retry: false,
  };
}

/** One guarded source shared by the header and sidebar; never suspends them. */
export function createPullRequestStatsSource(
  url: Accessor<string | undefined>,
  captureId: Accessor<string | undefined>
) {
  const query = useQuery(() =>
    pullRequestStatsQueryOptions(url(), captureId())
  );
  return () => (query.isSuccess ? (query.data ?? undefined) : undefined);
}
