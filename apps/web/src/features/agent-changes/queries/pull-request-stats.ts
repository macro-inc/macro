import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import {
  parseGithubPrUrl,
  prDisplayName,
  prHtmlUrl,
  toGithubKey,
} from '../../block-pr/util/prKey';
import { agentChangesKeys } from './keys';

export function pullRequestStatsQueryOptions(
  url: string | undefined,
  captureId?: string
) {
  const reference = url ? parseGithubPrUrl(url) : null;
  const githubKey = reference ? toGithubKey(reference) : '';
  return {
    queryKey: agentChangesKeys.pullRequestStats(githubKey, captureId ?? '')
      .queryKey,
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
      // Enrichment can return a bare reference when GitHub is unavailable.
      if (pr?.additions == null || pr.deletions == null) return null;
      return { additions: pr.additions, deletions: pr.deletions };
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
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
