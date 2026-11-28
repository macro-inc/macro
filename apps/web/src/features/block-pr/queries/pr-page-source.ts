import { fireAndForget } from '@core/util/fireAndForget';
import { useRefreshGithubPullRequest } from '@queries/storage/github-pull-requests';
import { githubPullRequestChangesKeys } from '@queries/storage/keys';
import type { GithubPullRequestUser } from '@service-storage/generated/schemas';
import { type Accessor, createMemo, type Owner } from 'solid-js';
import type { PrPageContext } from '../context/pr-page-context';
import type {
  PrPageReadModel,
  PrPageReviewer,
} from '../context/pr-page-read-model';
import { summarizeChecks } from '../data/checks';
import { createPrChangesSource } from '../data/pr-changes';
import { createSamplePrPage, prSampleScenario } from '../data/pr-page-samples';
import {
  type PrForeignEntityData,
  prForeignEntityQueryKey,
  usePrForeignEntityQuery,
} from '../data/queries';
import type { MergePullRequestTarget } from '../primitives/create-merge-pull-request-action';
import {
  createPrActions,
  type PrActions,
} from '../primitives/create-pr-actions';
import { createPrPageActions } from '../primitives/create-pr-page-actions';
import { prSamplesEnabled } from '../primitives/pr-page-state';
import { prPageTimeline } from '../primitives/pr-page-timeline';
import { prLinksTarget, usePrLinksQuery } from './pr-links-query';

/** Optional intersection until the backend PR adds these fields to PrForeignEntityData. */
type UpcomingPrData = PrForeignEntityData &
  Partial<{
    githubCreatedAt: string | null;
    baseBranch: string;
    defaultBranch: string;
    baseIsDefault: boolean;
    authorGithubUserId: string | null;
    reviewers: PrPageReviewer[];
    requestedReviewers: GithubPullRequestUser[];
    assignees: GithubPullRequestUser[];
    linkedMacroUsers: Record<string, string>;
    mergeState: 'mergeable' | 'conflicting' | 'unknown';
  }>;

/** Pure adapter, allowing backend-in-progress fields to remain absent. */
export function adaptPrPage(
  data: UpcomingPrData,
  changes: PrPageReadModel['changes'],
  links?: PrPageReadModel['links']
): PrPageReadModel {
  const comments = data.pullRequest.comments ?? [];
  const checks = data.pullRequest.checks ?? [];
  return {
    id: data.id,
    prRef: data.prRef,
    pullRequest: data.pullRequest,
    headBranch: data.headBranch,
    githubCreatedAt: data.githubCreatedAt,
    baseBranch: data.baseBranch,
    defaultBranch: data.defaultBranch,
    baseIsDefault: data.baseIsDefault,
    authorGithubUserId: data.authorGithubUserId,
    reviewers: data.reviewers,
    requestedReviewers: data.requestedReviewers,
    assignees: data.assignees,
    linkedMacroUsers: data.linkedMacroUsers,
    mergeState: data.mergeState,
    checks: summarizeChecks(checks),
    comments,
    timeline: prPageTimeline(comments),
    links,
    pushes: [],
    commitStatuses: [],
    pendingComments: [],
    changes,
  };
}

/** Route entry: sample mode never instantiates live query or mutation hooks. */
export function usePrPageContext(
  id: Accessor<string>,
  confirmMerge: (
    target: MergePullRequestTarget,
    owner: Owner | null
  ) => Promise<boolean>
): PrPageContext & {
  lifecycle?: PrActions;
  detail?: Accessor<PrForeignEntityData | undefined>;
} {
  if (prSamplesEnabled()) {
    let search = '';
    try {
      if (typeof location !== 'undefined') search = location.search;
    } catch {
      // Restricted browser environments do not expose location.
    }
    return createSamplePrPage(prSampleScenario(search));
  }
  const query = usePrForeignEntityQuery(id);
  const changes = createPrChangesSource(id);
  useRefreshGithubPullRequest(
    () => {
      if (query.isPending) return undefined;
      const data = query.data;
      if (!data) return undefined;
      const pr = data.pullRequest;
      return {
        displayName: pr.displayName,
        githubKey: pr.githubKey,
        number: pr.number,
        owner: pr.owner,
        repo: pr.repo,
        url: pr.url,
      };
    },
    () => [
      prForeignEntityQueryKey(id()),
      githubPullRequestChangesKeys.summary(id()).queryKey,
    ]
  );
  const links = usePrLinksQuery(() => {
    if (query.isPending || !query.data) return [];
    const data = query.data;
    return [
      prLinksTarget({
        ...data.prRef,
        ...data.pullRequest,
        headBranch: data.headBranch,
      }),
    ];
  });
  const page = createMemo(() =>
    query.isPending || !query.data
      ? undefined
      : adaptPrPage(
          query.data,
          changes,
          links.linksFor(query.data.pullRequest.url)
        )
  );
  const detail = () => (query.isPending ? undefined : query.data);
  const lifecycle = createPrActions(detail, confirmMerge);
  const actions = createPrPageActions(lifecycle);
  return {
    page,
    actions,
    lifecycle,
    detail,
    changesSource: changes,
    status: () =>
      query.isPending ? 'pending' : query.isError ? 'error' : 'success',
    retry: () => fireAndForget(query.refetch(), 'pr-page'),
  };
}
