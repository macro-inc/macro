import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError } from '@core/util/result';
import {
  type EnableAutoMergeInput,
  type MergeGithubPullRequestInput,
  useEnableAutoMergeMutation,
  useMergeGithubPullRequestMutation,
} from '@queries/storage/pr-merge';
import type { Accessor } from 'solid-js';
import { type PrRef, prDisplayName } from '../util/prKey';

/** The pull request a merge is asked for: its coordinates and a title to show. */
export type MergePullRequestTarget = PrRef & {
  title?: string | null;
};

export type MergePullRequestAction = {
  /** Ask, then merge. Resolves once the merge settled either way. */
  merge: (target: MergePullRequestTarget) => Promise<void>;
  pending: Accessor<boolean>;
};

export type EnableAutoMergeAction = {
  /** Enable auto-merge on the pull request. */
  enableAutoMerge: (target: MergePullRequestTarget) => Promise<void>;
  pending: Accessor<boolean>;
};

function mergeFailureMessage(error: unknown): string {
  if (error instanceof ThrownResultError && error.errors.length > 0) {
    return error.message;
  }
  return 'Failed to merge pull request';
}

function autoMergeFailureMessage(error: unknown): string {
  if (error instanceof ThrownResultError && error.errors.length > 0) {
    return error.message;
  }
  return 'Failed to enable auto-merge';
}

/**
 * Detects if the merge failure is due to pending CI checks, which would
 * make auto-merge a viable alternative. We check for specific GitHub error
 * patterns related to status checks and branch protection rules, rather than
 * generic "not mergeable" messages which could have other causes.
 */
function isAutoMergeCandidate(error: unknown): boolean {
  if (!(error instanceof ThrownResultError)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('required status') ||
    message.includes('status check') ||
    message.includes('checks must pass') ||
    message.includes('rule violations')
  );
}

/**
 * The merge flow both PR surfaces share: confirm, merge as the signed-in
 * user, and report the outcome. GitHub decides whether the user may merge
 * and names what blocks it, so a refusal is shown in GitHub's words.
 */
export function createMergePullRequestAction(options: {
  confirm: (target: MergePullRequestTarget) => Promise<boolean>;
  onMerged?: (target: MergePullRequestTarget) => void;
  onAutoMergeCandidate?: (
    target: MergePullRequestTarget,
    errorMessage: string
  ) => void;
}): MergePullRequestAction {
  const mutation = useMergeGithubPullRequestMutation();

  const merge = async (target: MergePullRequestTarget) => {
    if (mutation.isPending) return;
    const name = prDisplayName(target);
    const confirmed = await options.confirm(target);
    if (!confirmed || mutation.isPending) return;

    const input: MergeGithubPullRequestInput = {
      owner: target.owner,
      repo: target.repo,
      number: target.number,
    };
    try {
      await mutation.mutateAsync(input);
    } catch (error) {
      const errorMessage = mergeFailureMessage(error);
      if (isAutoMergeCandidate(error) && options.onAutoMergeCandidate) {
        options.onAutoMergeCandidate(target, errorMessage);
      } else {
        toast.failure(errorMessage);
      }
      return;
    }
    toast.success(`Merged ${name}`);
    options.onMerged?.(target);
  };

  return { merge, pending: () => mutation.isPending };
}

/**
 * Enable auto-merge on a pull request. Auto-merge will merge the PR
 * automatically once all required status checks pass.
 */
export function createEnableAutoMergeAction(options?: {
  onEnabled?: (target: MergePullRequestTarget) => void;
}): EnableAutoMergeAction {
  const mutation = useEnableAutoMergeMutation();

  const enableAutoMerge = async (target: MergePullRequestTarget) => {
    if (mutation.isPending) return;
    const name = prDisplayName(target);

    const input: EnableAutoMergeInput = {
      owner: target.owner,
      repo: target.repo,
      number: target.number,
    };
    try {
      await mutation.mutateAsync(input);
    } catch (error) {
      toast.failure(autoMergeFailureMessage(error));
      return;
    }
    toast.success(`Auto-merge enabled for ${name}`);
    options?.onEnabled?.(target);
  };

  return { enableAutoMerge, pending: () => mutation.isPending };
}
