import { queryClient } from '@queries/client';
import { downloadExportedDocument } from '@service-storage/util/downloadExportedDocument';
import { syncServiceClient } from '@service-sync/client';
import { createSyncServiceSource } from '@service-sync/source';
import type { DocumentSyncAuthorization } from '@service-sync/source/authorization';
import { buildSeedSnapshot } from '../core/docx-seed';
import type { DocxConnection } from './docx-session';
import { loadDocxodus } from './docxodus-runtime';

const docxKeys = {
  original: (documentId: string) => ['docx', 'original', documentId] as const,
};

/**
 * The DOCX as uploaded, rebuilt by document storage from its stored parts.
 * Cached so views opening the same file share one download.
 */
export function fetchOriginalDocx(documentId: string): Promise<Uint8Array> {
  return queryClient.fetchQuery({
    queryKey: docxKeys.original(documentId),
    queryFn: () => downloadExportedDocument({ documentId }),
  });
}

export async function docxSyncExists(documentId: string): Promise<boolean> {
  const result = await syncServiceClient.exists({ documentId });
  if (result.isErr()) throw new Error('Unable to reach the sync service.');
  return result.value.exists;
}

export async function initializeDocxSync(
  documentId: string,
  snapshot: Uint8Array
): Promise<void> {
  const result = await syncServiceClient.initializeFromSnapshot({
    documentId,
    snapshot,
  });
  if (result.isErr()) throw new Error('Unable to initialize collaboration.');
}

export async function buildDocxSeed(original: Uint8Array): Promise<Uint8Array> {
  const runtime = await loadDocxodus();
  return buildSeedSnapshot(runtime.exports.DocxSessionBridge, original);
}

export function connectDocxSync(
  documentId: string,
  token: string | undefined,
  authorization?: DocumentSyncAuthorization
): DocxConnection {
  return createSyncServiceSource(documentId, token, authorization);
}
