import {
  type PullRequestCheck,
  pullRequestReadyToMerge,
} from '@block-pr/primitives/pull-request-ready-to-merge';
import { match } from 'ts-pattern';

/** Where a pull request stands on its way to merging. */
export type ReviewsBoardStage =
  | 'draft'
  | 'review'
  | 'failing'
  | 'conflicts'
  | 'ready'
  | 'merged';

/** Whether GitHub can merge a pull request's head into its base. */
export type PullRequestMergeability = 'mergeable' | 'conflicting' | 'unknown';

export const REVIEWS_BOARD_STAGES: readonly {
  id: ReviewsBoardStage;
  label: string;
  description: string;
}[] = [
  {
    id: 'draft',
    label: 'Draft',
    description: 'Drop a pull request here to convert it to a draft',
  },
  {
    id: 'review',
    label: 'In review',
    description: 'Open, with checks running or none reported yet',
  },
  {
    id: 'failing',
    label: 'Checks failing',
    description: 'A check failed on the latest commit',
  },
  {
    id: 'conflicts',
    label: 'Conflicts',
    description: 'The branch conflicts with its base',
  },
  {
    id: 'ready',
    label: 'Ready to merge',
    description: 'Every check passed',
  },
  {
    id: 'merged',
    label: 'Merged',
    description: 'Drop a pull request here to merge it',
  },
];

/** Finished conclusions that fail the head commit. */
const FAILING_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
]);

/**
 * The column a pull request belongs in. A draft stays a draft whatever its
 * checks say; otherwise conflicts outrank failing checks, which outrank a
 * clean run. Closed pull requests have no column.
 */
export function reviewsBoardStage(input: {
  status: string | null | undefined;
  draft?: boolean | null;
  checks?: readonly PullRequestCheck[] | null;
  mergeability?: PullRequestMergeability;
}): ReviewsBoardStage | undefined {
  if (input.status === 'merged') return 'merged';
  if (input.status !== 'open') return undefined;
  if (input.draft) return 'draft';
  if (input.mergeability === 'conflicting') return 'conflicts';
  const failing = (input.checks ?? []).some(
    (check) =>
      check.status === 'completed' &&
      check.conclusion != null &&
      FAILING_CONCLUSIONS.has(check.conclusion)
  );
  if (failing) return 'failing';
  if (pullRequestReadyToMerge(input)) return 'ready';
  return 'review';
}

/** What dropping a card between two columns does on GitHub. */
export type ReviewsBoardAction = 'merge' | 'convert-to-draft' | 'mark-ready';

/**
 * The GitHub action a move asks for, or `undefined` when the move is not
 * allowed. Checks, conflicts, and readiness are GitHub's verdicts, so only
 * Draft, In review, and Merged accept drops; a merge comes from In review
 * or Ready to merge, and GitHub still decides whether it goes through.
 */
export function reviewsBoardAction(
  from: ReviewsBoardStage,
  to: ReviewsBoardStage
): ReviewsBoardAction | undefined {
  if (from === to || from === 'merged') return undefined;
  return match(to)
    .with('draft', () => 'convert-to-draft' as const)
    .with('review', () =>
      from === 'draft' ? ('mark-ready' as const) : undefined
    )
    .with('merged', () =>
      from === 'ready' || from === 'review' ? ('merge' as const) : undefined
    )
    .with('failing', 'conflicts', 'ready', () => undefined)
    .exhaustive();
}

export const isReviewsBoardStage = (
  value: string
): value is ReviewsBoardStage =>
  REVIEWS_BOARD_STAGES.some((stage) => stage.id === value);
