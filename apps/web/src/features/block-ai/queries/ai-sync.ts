/**
 * The sync service as a shared Illustrator document needs it: whether the
 * shared copy exists, storing its first snapshot, and the live transport.
 */

import { syncServiceClient } from '@service-sync/client';
import { createSyncServiceSource } from '@service-sync/source';
import type { AiConnection } from './ai-collab';

/** Whether the sync service holds this document. */
export async function documentSyncExists(documentId: string): Promise<boolean> {
  const result = await syncServiceClient.exists({ documentId });
  if (result.isErr()) throw new Error('Unable to reach the sync service.');
  return result.value.exists;
}

/** Stores the first shared snapshot of a document. */
export async function initializeDocumentSync(
  documentId: string,
  snapshot: Uint8Array
): Promise<void> {
  const result = await syncServiceClient.initializeFromSnapshot({
    documentId,
    snapshot,
  });
  if (result.isErr()) throw new Error('Unable to share the document.');
}

/** The live transport; it fetches a fresh permission token on each connect. */
export function connectDocumentSync(documentId: string): AiConnection {
  return createSyncServiceSource(documentId, undefined);
}
