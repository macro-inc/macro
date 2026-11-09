import { throwOnErr } from '@core/util/result';
import {
  agentHarnessServiceClient,
  type DocumentBuildResponse,
  type RunDocumentProgram,
  type UserExecutionReceipt,
} from '@service-agent-harness/client';
import { queryOptions } from '@tanstack/solid-query';
import { documentProgramKeys } from './keys';

export type { DocumentBuildResponse, RunDocumentProgram, UserExecutionReceipt };

/**
 * The server's build of a stored HTML document: the page to render with its
 * program ids, or why it doesn't build. Refetched whenever a preview mounts,
 * so a reopened preview shows the saved source.
 */
export function documentBuildQueryOptions(documentId: string) {
  return queryOptions({
    queryKey: documentProgramKeys.build(documentId).queryKey,
    staleTime: 0,
    retry: false,
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
