import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type { SetGithubPullRequestDraftRequest } from '@service-auth/generated/schemas';
import { useMutation } from '@tanstack/solid-query';
import { invalidateMergedPullRequestCaches } from './pr-merge';

export type SetGithubPullRequestDraftInput = SetGithubPullRequestDraftRequest;

/**
 * Convert a GitHub pull request to a draft, or mark it ready for review, as
 * the signed-in user. A refusal rejects with GitHub's message as the error
 * text. The route patches the stored entity before answering, so the same
 * caches a merge refreshes are refreshed here.
 */
export function useSetGithubPullRequestDraftMutation() {
  return useMutation(() => ({
    mutationFn: async (input: SetGithubPullRequestDraftInput) =>
      await throwOnErr(() =>
        authServiceClient.setGithubPullRequestDraft(input)
      ),
    onSuccess: () => invalidateMergedPullRequestCaches(),
  }));
}
