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
import { useQuery, useQueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { documentGithubPullRequestsKeys } from './keys';

const DOCUMENT_GITHUB_PULL_REQUESTS_STALE_TIME = 60 * 1000;
const PR_QUERY_LOG_PREFIX = '[pr-block:loading]';

function logDocumentPrLoading(message: string, details?: unknown) {
  const time = Math.round(performance.now());
  if (details === undefined) {
    console.log(PR_QUERY_LOG_PREFIX, `${time}ms`, message);
    return;
  }
  console.log(PR_QUERY_LOG_PREFIX, `${time}ms`, message, details);
}

type DocumentIdInput =
  | string
  | null
  | undefined
  | Accessor<string | null | undefined>;
type EnabledInput = boolean | Accessor<boolean>;

type FetchDocumentGithubPullRequestsOptions = {
  onInitialResponse?: (response: GithubPullRequestsResponse) => void;
};

function readDocumentId(
  documentId: DocumentIdInput
): string | null | undefined {
  return typeof documentId === 'function' ? documentId() : documentId;
}

function readEnabled(enabled: EnabledInput | undefined): boolean {
  if (enabled === undefined) return true;
  return typeof enabled === 'function' ? enabled() : enabled;
}

/**
 * Storage pull request extended with enrichment-only fields. The documents
 * service doesn't expose body/author yet, so they only arrive via the live
 * enrich merge and must stay optional.
 */
export type GithubPullRequestWithDetails = GithubPullRequest & {
  description?: string | null;
  authorLogin?: string | null;
};

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
  pullRequest: EnrichedGithubPullRequest,
  fallbackPullRequest: GithubPullRequestWithDetails | undefined
): GithubPullRequestWithDetails {
  return {
    additions: pullRequest.additions ?? fallbackPullRequest?.additions,
    authorLogin: pullRequest.authorLogin ?? fallbackPullRequest?.authorLogin,
    description: pullRequest.description ?? fallbackPullRequest?.description,
    checks: pullRequest.checks ?? fallbackPullRequest?.checks,
    comments: pullRequest.comments ?? fallbackPullRequest?.comments,
    deletions: pullRequest.deletions ?? fallbackPullRequest?.deletions,
    displayName: pullRequest.displayName,
    foreignEntityId: fallbackPullRequest?.foreignEntityId,
    githubKey: pullRequest.githubKey,
    name: pullRequest.name ?? fallbackPullRequest?.name,
    number: pullRequest.number,
    owner: pullRequest.owner,
    repo: pullRequest.repo,
    status: pullRequest.status ?? fallbackPullRequest?.status,
    url: pullRequest.url,
  };
}

function createPullRequestFallbacksByKey(
  pullRequests: GithubPullRequest[]
): Map<string, GithubPullRequest> {
  return new Map(
    pullRequests.map((pullRequest) => [pullRequest.githubKey, pullRequest])
  );
}

function hasStoredEnrichedGithubPullRequestData(
  pullRequest: GithubPullRequest
): boolean {
  return (
    pullRequest.additions != null ||
    pullRequest.checks != null ||
    pullRequest.comments != null ||
    pullRequest.deletions != null ||
    pullRequest.name != null ||
    pullRequest.status != null
  );
}

function hasStoredEnrichedGithubPullRequests(
  response: GithubPullRequestsResponse
): boolean {
  return response.pullRequests.some(hasStoredEnrichedGithubPullRequestData);
}

export type GithubPullRequestsWithDetailsResponse = {
  pullRequests: GithubPullRequestWithDetails[];
};

export async function fetchDocumentGithubPullRequests(
  documentId: string,
  options?: FetchDocumentGithubPullRequestsOptions
): Promise<GithubPullRequestsWithDetailsResponse> {
  logDocumentPrLoading('document PR fetch start', { documentId });
  const rawResponse = await throwOnErr(() =>
    storageServiceClient.getDocumentGithubPullRequests({ documentId })
  );
  logDocumentPrLoading('document PR storage response', {
    documentId,
    count: rawResponse.pullRequests.length,
    hasStoredEnrichedData: hasStoredEnrichedGithubPullRequests(rawResponse),
    pullRequests: rawResponse.pullRequests.map((pullRequest) => ({
      githubKey: pullRequest.githubKey,
      hasName: !!pullRequest.name,
      status: pullRequest.status,
      checks: pullRequest.checks?.length ?? null,
      comments: pullRequest.comments?.length ?? null,
      additions: pullRequest.additions,
      deletions: pullRequest.deletions,
    })),
  });

  if (rawResponse.pullRequests.length === 0) {
    logDocumentPrLoading('document PR fetch returning empty storage response', {
      documentId,
    });
    return rawResponse;
  }

  if (hasStoredEnrichedGithubPullRequests(rawResponse)) {
    logDocumentPrLoading('document PR setting intermediate storage cache', {
      documentId,
      count: rawResponse.pullRequests.length,
    });
    options?.onInitialResponse?.(rawResponse);
  }

  logDocumentPrLoading('document PR enrichment request start', {
    documentId,
    count: rawResponse.pullRequests.length,
  });
  const enrichedResponse = await authServiceClient.enrichGithubPullRequests({
    pullRequests: rawResponse.pullRequests.map(toGithubPullRequestRef),
  });

  if (enrichedResponse.isErr()) {
    logDocumentPrLoading('document PR enrichment failed; returning storage', {
      documentId,
      codes: enrichedResponse.error.map((error) => String(error.code)),
    });
    return rawResponse;
  }

  const fallbackPullRequestsByKey = createPullRequestFallbacksByKey(
    rawResponse.pullRequests
  );

  const mergedResponse = {
    pullRequests: enrichedResponse.value.pullRequests.map(
      (pullRequest, index) =>
        toStorageGithubPullRequest(
          pullRequest,
          fallbackPullRequestsByKey.get(pullRequest.githubKey) ??
            rawResponse.pullRequests[index]
        )
    ),
  };
  logDocumentPrLoading('document PR enrichment success; returning merged', {
    documentId,
    count: mergedResponse.pullRequests.length,
    pullRequests: mergedResponse.pullRequests.map((pullRequest) => ({
      githubKey: pullRequest.githubKey,
      hasName: !!pullRequest.name,
      hasDescription: !!pullRequest.description,
      authorLogin: pullRequest.authorLogin,
      checks: pullRequest.checks?.length ?? null,
      comments: pullRequest.comments?.length ?? null,
    })),
  });
  return mergedResponse;
}

export function useDocumentGithubPullRequestsQuery(
  documentId: DocumentIdInput,
  enabled?: EnabledInput
) {
  const queryClient = useQueryClient();

  return useQuery(() => {
    const currentDocumentId = readDocumentId(documentId);
    const currentEnabled = !!currentDocumentId && readEnabled(enabled);
    const queryKey = currentDocumentId
      ? documentGithubPullRequestsKeys.list(currentDocumentId).queryKey
      : documentGithubPullRequestsKeys.list._def;

    logDocumentPrLoading('document PR query options evaluated', {
      documentId: currentDocumentId,
      enabled: currentEnabled,
      queryKey,
    });

    return {
      queryKey,
      queryFn: () => {
        if (!currentDocumentId) {
          throw new Error(
            'Document ID is required to fetch GitHub pull requests'
          );
        }
        return fetchDocumentGithubPullRequests(currentDocumentId, {
          onInitialResponse: (initialResponse) => {
            queryClient.setQueryData(queryKey, initialResponse);
          },
        });
      },
      staleTime: DOCUMENT_GITHUB_PULL_REQUESTS_STALE_TIME,
      enabled: currentEnabled,
    };
  });
}
