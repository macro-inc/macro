import type { ChangesSource } from '@app/features/changes/context/changes-context';
import type { GithubPullRequestWithDetails } from '@queries/storage/github-pull-requests';
import type {
  GithubPullRequestComment,
  GithubPullRequestReview,
  GithubPullRequestUser,
} from '@service-storage/generated/schemas';
import type { ChecksSummary } from '../data/checks';
import type { PrLinks } from '../data/pr-links';
import type { TimelineEntry } from '../data/timeline';
import type { PrRef } from '../util/prKey';

export type PrPageLineAnchor = {
  path: string;
  line: number;
  diffSide: 'additions' | 'deletions';
  startLine?: number;
  startSide?: 'additions' | 'deletions';
};

/** Backend-in-progress review state, layered on the generated comment contract. */
export type PrPageComment = GithubPullRequestComment & {
  reviewState?: GithubPullRequestReview['state'];
  /** Stub: captured legacy comments omit the diff side; sample drafts retain it. */
  diffSide?: PrPageLineAnchor['diffSide'];
  startLine?: number;
  startSide?: PrPageLineAnchor['startSide'];
};

/** Backend-in-progress merged reviewer list; requested is not a submitted review. */
export type PrPageReviewer = {
  githubUserId: string;
  login?: string | null;
  state: GithubPullRequestReview['state'] | 'requested';
  submittedAt?: string | null;
};

/** One read snapshot. Absent in-progress fields never imply a negative answer. */
export type PrPageReadModel = {
  /** Live: stored PR identity and enrichment. */
  id: string;
  prRef: PrRef;
  pullRequest: GithubPullRequestWithDetails;
  /** Live: head branch when stored. */
  headBranch?: string;
  /** Backend-in-progress: absent on old stored records. */
  githubCreatedAt?: string | null;
  baseBranch?: string;
  defaultBranch?: string;
  baseIsDefault?: boolean;
  authorGithubUserId?: string | null;
  reviewers?: PrPageReviewer[];
  requestedReviewers?: GithubPullRequestUser[];
  assignees?: GithubPullRequestUser[];
  linkedMacroUsers?: Record<string, string>;
  mergeState?: 'mergeable' | 'conflicting' | 'unknown';
  /** Stub: viewer GitHub role cannot be inferred without a linked identity. */
  viewerIsAuthor?: boolean;
  /** Stub: automatic merge preferences are local to sample mode. */
  mergeWhenReady?: boolean;
  /** Live: checks and conversation, including comments' optional review state. */
  checks: ChecksSummary;
  comments: PrPageComment[];
  timeline: TimelineEntry[];
  /** Live: sessions, tasks, companies and priority. Absent while links load. */
  links?: PrLinks;
  /** Stub: no stack, pushes, commit statuses, or required-check API. */
  stack?: {
    position: number;
    total: number;
    items: readonly {
      id: string;
      title: string;
      status: 'open' | 'draft' | 'merged' | 'closed';
      number?: number;
    }[];
  };
  pushes: readonly { id: string; createdAt: string; label: string }[];
  commitStatuses: readonly [];
  requiredChecks?: readonly string[];
  /** Stub: viewed-file state does not exist. */
  viewedFiles?: readonly string[];
  /** Stub: pending review comments do not exist in live data. */
  pendingComments: readonly PrPageComment[];
  /** Live: existing ChangesSource, kept lazy by its own patch accessor. */
  changes: ChangesSource;
};
