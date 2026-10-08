import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { authServiceClient } from '@service-auth/client';
import type {
  EnableAutoMergeRequest,
  EnableAutoMergeResponse,
  MergeGithubPullRequestRequest,
  MergeGithubPullRequestResponse,
} from '@service-auth/generated/schemas';
import { useMutation } from '@tanstack/solid-query';
import { documentGithubPullRequestsKeys, pullRequestMentionKeys } from './keys';

export type MergeGithubPullRequestInput = MergeGithubPullRequestRequest;
export type EnableAutoMergeInput = EnableAutoMergeRequest;

type UseMergeGithubPullRequestMutationOptions = {
  /** Runs after the shared caches are refreshed, for feature-owned ones. */
  onSuccess?: (
    response: MergeGithubPullRequestResponse,
    input: MergeGithubPullRequestInput
  ) => void;
};

type UseEnableAutoMergeMutationOptions = {
  /** Runs after auto-merge is enabled successfully. */
  onSuccess?: (
    response: EnableAutoMergeResponse,
    input: EnableAutoMergeInput
  ) => void;
};

/**
 * Refresh every cached view of pull requests after one was merged: mention
 * and chip lookups by id and GitHub key, and per-document PR lists. The
 * merge route patches the stored entity before answering, so a refetch
 * already sees it merged rather than waiting on GitHub's webhook.
 */
export function invalidateMergedPullRequestCaches(): void {
  void queryClient.invalidateQueries({ queryKey: pullRequestMentionKeys._def });
  void queryClient.invalidateQueries({
    queryKey: documentGithubPullRequestsKeys._def,
  });
}

/**
 * Merge a GitHub pull request as the signed-in user, with their own GitHub
 * grant. GitHub decides whether they may: a refusal rejects with GitHub's
 * message as the error text, so callers can show it as is.
 */
export function useMergeGithubPullRequestMutation(
  options?: UseMergeGithubPullRequestMutationOptions
) {
  return useMutation(() => ({
    mutationFn: async (input: MergeGithubPullRequestInput) =>
      await throwOnErr(() => authServiceClient.mergeGithubPullRequest(input)),
    onSuccess: (response, input) => {
      invalidateMergedPullRequestCaches();
      options?.onSuccess?.(response, input);
    },
  }));
}

/**
 * Enable auto-merge on a GitHub pull request as the signed-in user. Auto-merge
 * will merge the pull request automatically once all required status checks
 * pass. GitHub decides whether auto-merge can be enabled: a refusal rejects
 * with GitHub's message as the error text, so callers can show it as is.
 */
export function useEnableAutoMergeMutation(
  options?: UseEnableAutoMergeMutationOptions
) {
  return useMutation(() => ({
    mutationFn: async (input: EnableAutoMergeInput) =>
      await throwOnErr(() =>
        authServiceClient.enableAutoMergeGithubPullRequest(input)
      ),
    onSuccess: (response, input) => {
      options?.onSuccess?.(response, input);
    },
  }));
}
