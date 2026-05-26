import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type {
  EnrichedGithubPullRequest,
  GithubPullRequestRef,
} from '@service-auth/generated/schemas';
import { storageServiceClient } from '@service-storage/client';
import type {
  GithubPullRequest,
  GithubPullRequestsResponse,
} from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { documentGithubPullRequestsKeys } from './keys';

const DOCUMENT_GITHUB_PULL_REQUESTS_STALE_TIME = 60 * 1000;

type DocumentIdInput =
  | string
  | null
  | undefined
  | Accessor<string | null | undefined>;
type EnabledInput = boolean | Accessor<boolean>;

function readDocumentId(
  documentId: DocumentIdInput
): string | null | undefined {
  return typeof documentId === 'function' ? documentId() : documentId;
}

function readEnabled(enabled: EnabledInput | undefined): boolean {
  if (enabled === undefined) return true;
  return typeof enabled === 'function' ? enabled() : enabled;
}

function toGithubPullRequestRef(
  pullRequest: GithubPullRequest
): GithubPullRequestRef {
  return {
    displayName: pullRequest.displayName,
    githubKey: pullRequest.githubKey,
    number: pullRequest.number,
    owner: pullRequest.owner,
    repo: pullRequest.repo,
    url: pullRequest.url,
  };
}

function toStorageGithubPullRequest(
  pullRequest: EnrichedGithubPullRequest
): GithubPullRequest {
  return {
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
    displayName: pullRequest.displayName,
    githubKey: pullRequest.githubKey,
    name: pullRequest.name,
    number: pullRequest.number,
    owner: pullRequest.owner,
    repo: pullRequest.repo,
    status: pullRequest.status,
    url: pullRequest.url,
  };
}

async function fetchDocumentGithubPullRequests(
  documentId: string
): Promise<GithubPullRequestsResponse> {
  const rawResponse = await throwOnErr(() =>
    storageServiceClient.getDocumentGithubPullRequests({ documentId })
  );

  if (rawResponse.pullRequests.length === 0) {
    return rawResponse;
  }

  const enrichedResponse = await authServiceClient.enrichGithubPullRequests({
    pullRequests: rawResponse.pullRequests.map(toGithubPullRequestRef),
  });

  if (enrichedResponse.isErr()) {
    return rawResponse;
  }

  return {
    pullRequests: enrichedResponse.value.pullRequests.map(
      toStorageGithubPullRequest
    ),
  };
}

export function useDocumentGithubPullRequestsQuery(
  documentId: DocumentIdInput,
  enabled?: EnabledInput
) {
  return useQuery(() => {
    const currentDocumentId = readDocumentId(documentId);

    return {
      queryKey: currentDocumentId
        ? documentGithubPullRequestsKeys.list(currentDocumentId).queryKey
        : documentGithubPullRequestsKeys.list._def,
      queryFn: () => {
        if (!currentDocumentId) {
          throw new Error(
            'Document ID is required to fetch GitHub pull requests'
          );
        }
        return fetchDocumentGithubPullRequests(currentDocumentId);
      },
      staleTime: DOCUMENT_GITHUB_PULL_REQUESTS_STALE_TIME,
      enabled: !!currentDocumentId && readEnabled(enabled),
    };
  });
}
