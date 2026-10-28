/**
 * The sync service as a shared design needs it: whether the shared copy
 * exists, storing its first snapshot, and the live transport.
 */

import { syncServiceClient } from '@service-sync/client';
import { createSyncServiceSource } from '@service-sync/source';
import type { DesignConnection } from './fig-collab';

/** Whether the sync service holds this design. */
export async function designSyncExists(documentId: string): Promise<boolean> {
  const result = await syncServiceClient.exists({ documentId });
  if (result.isErr()) throw new Error('Unable to reach the sync service.');
  return result.value.exists;
}

/** Stores the first shared snapshot of a design. */
export async function initializeDesignSync(
  documentId: string,
  snapshot: Uint8Array
): Promise<void> {
  const result = await syncServiceClient.initializeFromSnapshot({
    documentId,
    snapshot,
  });
  if (result.isErr()) throw new Error('Unable to share the design.');
}

/** The live transport; it fetches a fresh permission token on each connect. */
export function connectDesignSync(documentId: string): DesignConnection {
  return createSyncServiceSource(documentId, undefined);
}
