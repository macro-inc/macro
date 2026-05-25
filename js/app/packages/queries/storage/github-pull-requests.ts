import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { GithubPullRequestsResponse } from '@service-storage/generated/schemas';
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

async function fetchDocumentGithubPullRequests(
  documentId: string
): Promise<GithubPullRequestsResponse> {
  return await throwOnErr(() =>
    storageServiceClient.getDocumentGithubPullRequests({ documentId })
  );
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
