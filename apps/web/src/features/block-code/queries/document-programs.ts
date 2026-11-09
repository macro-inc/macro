import { throwOnErr } from '@core/util/result';
import {
  type DocumentProgramReceipt,
  type RunDocumentProgramRequest,
  agentHarnessServiceClient,
} from '@service-agent-harness/client';

export type { DocumentProgramReceipt, RunDocumentProgramRequest };

/**
 * Run a program from the open HTML document on the server, as the viewer.
 * Not cached: every call is a fresh run whose writes stand.
 */
export async function runDocumentProgram(
  documentId: string,
  request: RunDocumentProgramRequest,
  signal?: AbortSignal
): Promise<DocumentProgramReceipt> {
  return throwOnErr(() =>
    agentHarnessServiceClient.runDocumentProgram(documentId, request, signal)
  );
}
