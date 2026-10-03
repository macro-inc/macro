import { platformFetch } from '@core/util/platformFetch';
import { storageServiceClient } from '@service-storage/client';
import { syncServiceClient } from '@service-sync/client';
import { createSyncServiceSource } from '@service-sync/source';
import { buildSeedSnapshot } from '../core/docx-seed';
import type { DocxConnection } from './docx-session';
import { loadDocxodus } from './docxodus-runtime';

/** The DOCX as uploaded, rebuilt by document storage from its stored parts. */
export async function fetchOriginalDocx(
  documentId: string
): Promise<Uint8Array> {
  const exported = await storageServiceClient.exportDocument({ documentId });
  if (exported.isErr())
    throw new Error('Unable to load the uploaded document.');
  const response = await platformFetch(exported.value.presigned_url);
  if (!response.ok)
    throw new Error(
      `Unable to download the uploaded document (${response.status}).`
    );
  return new Uint8Array(await response.arrayBuffer());
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
  token: string | undefined
): DocxConnection {
  return createSyncServiceSource(documentId, token);
}
