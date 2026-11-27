import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import type { GithubPullRequestWithDetails } from '@queries/storage/github-pull-requests';
import { invalidateActivePrDetail } from '@queries/storage/pr-detail-sync';
import { storageServiceClient } from '@service-storage/client';
import type { GithubPullRequestReview } from '@service-storage/generated/schemas/githubPullRequestReview';
import type { StoredGithubPullRequest } from '@service-storage/generated/schemas/storedGithubPullRequest';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

import type { PrRef } from '../util/prKey';
import { prDisplayName } from '../util/prKey';
import { prForeignEntityQueryKey } from './keys';

export { prForeignEntityQueryKey } from './keys';

const PR_STALE_TIME = 60 * 1000;

export type PrGithubUser = { githubUserId: string; login?: string };

export type PrReviewer = PrGithubUser & {
  state: 'requested' | GithubPullRequestReview['state'];
  submittedAt?: string;
};

const REVIEW_STATE_ORDER: PrReviewer['state'][] = [
  'changes_requested',
  'approved',
  'commented',
  'requested',
  'dismissed',
];

export type PrForeignEntityData = {
  id: string;
  prRef: PrRef;
  pullRequest: GithubPullRequestWithDetails;
  /** The branch carrying the pull request's changes, when stored. */
  headBranch?: string;
  /** When GitHub opened the pull request, if known. */
  githubCreatedAt?: string;
  authorGithubUserId?: string;
  assignees: PrGithubUser[];
  requestedReviewers: PrGithubUser[];
  reviewers: PrReviewer[];
  baseBranch?: string;
  defaultBranch?: string;
  baseIsDefault: boolean;
  linkedMacroUsers: Record<string, string>;
};

/** Refetch active detail readers after a PR action, sharing push burst coordination. */
export function invalidatePrForeignEntity(id: string): void {
  fireAndForget(invalidateActivePrDetail(queryClient, id), 'pr-detail-refresh');
}

function prReviewersFromStored(
  pullRequest: StoredGithubPullRequest
): PrReviewer[] {
  const reviewers = new Map<string, PrReviewer>();
  for (const user of pullRequest.requestedReviewers ?? []) {
    reviewers.set(user.githubUserId, {
      githubUserId: user.githubUserId,
      login: user.login ?? undefined,
      state: 'requested',
    });
  }
  // Older rows retain the ids even when the requested users have no names.
  for (const githubUserId of pullRequest.requestedReviewerGithubUserIds) {
    if (!reviewers.has(githubUserId)) {
      reviewers.set(githubUserId, { githubUserId, state: 'requested' });
    }
  }
  for (const review of pullRequest.reviews) {
    const previous = reviewers.get(review.reviewerGithubUserId);
    reviewers.set(review.reviewerGithubUserId, {
      githubUserId: review.reviewerGithubUserId,
      login: review.reviewerLogin ?? previous?.login,
      state: review.state,
      submittedAt: review.submittedAt ?? undefined,
    });
  }
  return [...reviewers.values()].sort(
    (a, b) =>
      REVIEW_STATE_ORDER.indexOf(a.state) -
        REVIEW_STATE_ORDER.indexOf(b.state) ||
      (a.login ?? a.githubUserId).localeCompare(
        b.login ?? b.githubUserId,
        undefined,
        {
          sensitivity: 'base',
        }
      ) ||
      a.githubUserId.localeCompare(b.githubUserId)
  );
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
    headBranch: pullRequest.head?.name ?? undefined,
    githubCreatedAt: pullRequest.githubCreatedAt ?? undefined,
    authorGithubUserId: pullRequest.authorGithubUserId ?? undefined,
    assignees: (pullRequest.assignees ?? []).map((user) => ({
      githubUserId: user.githubUserId,
      login: user.login ?? undefined,
    })),
    requestedReviewers: (pullRequest.requestedReviewers ?? []).map((user) => ({
      githubUserId: user.githubUserId,
      login: user.login ?? undefined,
    })),
    reviewers: prReviewersFromStored(pullRequest),
    baseBranch: pullRequest.base?.name ?? undefined,
    defaultBranch: pullRequest.defaultBranch ?? undefined,
    baseIsDefault:
      pullRequest.base?.name != null &&
      pullRequest.defaultBranch != null &&
      pullRequest.base.name === pullRequest.defaultBranch,
    linkedMacroUsers: pullRequest.linkedMacroUsers ?? {},
    pullRequest: {
      additions: pullRequest.additions,
      authorLogin: pullRequest.authorLogin,
      description: pullRequest.description,
      checks: pullRequest.checks,
      comments: pullRequest.comments,
      draft: pullRequest.draft,
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
  return queryOptions({
    queryKey: prForeignEntityQueryKey(id),
    queryFn: async (): Promise<PrForeignEntityData> =>
      prForeignEntityDataFromStored(
        await throwOnErr(() =>
          storageServiceClient.getGithubPullRequest({ id })
        )
      ),
    staleTime: PR_STALE_TIME,
    retry: 1,
    reconcile: 'id',
  });
}

export function usePrForeignEntityQuery(id: Accessor<string>) {
  return useQuery(() => prForeignEntityQueryOptions(id()));
}
