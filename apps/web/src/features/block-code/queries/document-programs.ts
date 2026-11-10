import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import {
  agentHarnessServiceClient,
  type DocumentBuildResponse,
  type RunDocumentProgram,
  type UserExecutionReceipt,
} from '@service-agent-harness/client';
import { keepPreviousData, queryOptions } from '@tanstack/solid-query';
import { documentProgramKeys } from './keys';

export type { DocumentBuildResponse, RunDocumentProgram, UserExecutionReceipt };

/** Retries of a build the server failed, with the default backoff. */
const BUILD_RETRIES = 3;

/** Retry only a server failure; a refusal answers the same again. */
function retryBuild(failures: number, error: unknown): boolean {
  return (
    failures < BUILD_RETRIES && thrownResultErrorHasCode(error, 'SERVER_ERROR')
  );
}

/**
 * The server's build of a stored HTML document: the page to render with its
 * program ids, a plain page to show as it is, or why it doesn't build.
 * `savedVersion` counts the editor's completed saves, so each save builds
 * the source it saved. Refetched whenever a preview mounts, so a reopened
 * preview shows the saved source.
 */
export function documentBuildQueryOptions(
  documentId: string,
  savedVersion: number,
  enabled: boolean
) {
  return queryOptions({
    queryKey: documentProgramKeys.build(documentId, savedVersion).queryKey,
    staleTime: 0,
    enabled,
    // A save's new build replaces the page only once it arrives.
    placeholderData: keepPreviousData,
    retry: retryBuild,
    queryFn: ({ signal }) =>
      throwOnErr(() =>
        agentHarnessServiceClient.getDocumentBuild(documentId, signal)
      ),
  });
}

/**
 * Run one program of the build the page shows, on the server, as the
 * viewer. Not cached: every call is a fresh run whose writes stand.
 */
export async function runDocumentProgram(
  documentId: string,
  request: RunDocumentProgram,
  signal?: AbortSignal
): Promise<UserExecutionReceipt> {
  return throwOnErr(() =>
    agentHarnessServiceClient.runDocumentProgram(documentId, request, signal)
  );
}
