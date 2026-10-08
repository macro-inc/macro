import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError } from '@core/util/result';
import {
  type MergeGithubPullRequestInput,
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

function mergeFailureMessage(error: unknown): string {
  // A declined merge carries GitHub's own reason; anything else is ours.
  if (error instanceof ThrownResultError && error.errors.length > 0) {
    return error.message;
  }
  return 'Failed to merge pull request';
}

/**
 * The merge flow both PR surfaces share: confirm, merge as the signed-in
 * user, and report the outcome. GitHub decides whether the user may merge
 * and names what blocks it, so a refusal is shown in GitHub's words.
 */
export function createMergePullRequestAction(options: {
  confirm: (target: MergePullRequestTarget) => Promise<boolean>;
  onMerged?: (target: MergePullRequestTarget) => void;
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
      toast.failure(mergeFailureMessage(error));
      return;
    }
    toast.success(`Merged ${name}`);
    options.onMerged?.(target);
  };

  return { merge, pending: () => mutation.isPending };
}
