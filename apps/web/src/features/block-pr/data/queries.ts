import { throwOnErr } from '@core/util/result';
import type { GithubPullRequestWithDetails } from '@queries/storage/github-pull-requests';
import { storageServiceClient } from '@service-storage/client';
import type { StoredGithubPullRequest } from '@service-storage/generated/schemas/storedGithubPullRequest';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

import type { PrRef } from '../util/prKey';
import { prDisplayName } from '../util/prKey';

const PR_STALE_TIME = 60 * 1000;

export type PrForeignEntityData = {
  id: string;
  prRef: PrRef;
  pullRequest: GithubPullRequestWithDetails;
};

export function prForeignEntityQueryKey(id: string): string[] {
  return ['github-pr', 'foreign-entity', id];
}

function prForeignEntityDataFromStored(
  pullRequest: StoredGithubPullRequest
): PrForeignEntityData {
  const prRef: PrRef = {
    owner: pullRequest.owner,
    repo: pullRequest.repo,
    number: pullRequest.number,
  };

  return {
    id: pullRequest.id,
    prRef,
    pullRequest: {
      additions: pullRequest.additions,
      authorLogin: pullRequest.authorLogin,
      description: pullRequest.description,
      checks: pullRequest.checks,
      comments: pullRequest.comments,
      deletions: pullRequest.deletions,
      displayName: prDisplayName(prRef),
      foreignEntityId: pullRequest.id,
      githubKey: pullRequest.githubKey,
      labels: pullRequest.labels,
      name: pullRequest.title,
      number: pullRequest.number,
      owner: pullRequest.owner,
      repo: pullRequest.repo,
      status: pullRequest.status,
      url: pullRequest.url,
    },
  };
}

export function prForeignEntityQueryOptions(id: string) {
  return {
    queryKey: prForeignEntityQueryKey(id),
    queryFn: async (): Promise<PrForeignEntityData> =>
      prForeignEntityDataFromStored(
        await throwOnErr(() =>
          storageServiceClient.getGithubPullRequest({ id })
        )
      ),
    staleTime: PR_STALE_TIME,
    retry: 1,
  };
}

export function usePrForeignEntityQuery(id: Accessor<string>) {
  return useQuery(() => prForeignEntityQueryOptions(id()));
}
