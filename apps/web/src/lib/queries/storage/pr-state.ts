import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type { SetGithubPullRequestStateRequest } from '@service-auth/generated/schemas';
import { useMutation } from '@tanstack/solid-query';
import { invalidateMergedPullRequestCaches } from './pr-merge';

export type SetGithubPullRequestStateInput = SetGithubPullRequestStateRequest;

/**
 * Close a GitHub pull request, or reopen it, as the signed-in user. A refusal
 * rejects with GitHub's message as the error text. The route patches the
 * stored entity before answering, so the same caches a merge refreshes are
 * refreshed here.
 */
export function useSetGithubPullRequestStateMutation() {
  return useMutation(() => ({
    mutationFn: async (input: SetGithubPullRequestStateInput) =>
      await throwOnErr(() =>
        authServiceClient.setGithubPullRequestState(input)
      ),
    onSuccess: () => invalidateMergedPullRequestCaches(),
  }));
}
