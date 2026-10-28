/**
 * The sync service as a shared presentation needs it: whether the shared
 * copy exists, storing its first snapshot, and the live transport.
 */

import { syncServiceClient } from '@service-sync/client';
import { createSyncServiceSource } from '@service-sync/source';
import type { PresentationConnection } from './presentation-collab';

/** Whether the sync service holds this presentation. */
export async function presentationSyncExists(
  documentId: string
): Promise<boolean> {
  const result = await syncServiceClient.exists({ documentId });
  if (result.isErr()) throw new Error('Unable to reach the sync service.');
  return result.value.exists;
}

/** Stores the first shared snapshot of a presentation. */
export async function initializePresentationSync(
  documentId: string,
  snapshot: Uint8Array
): Promise<void> {
  const result = await syncServiceClient.initializeFromSnapshot({
    documentId,
    snapshot,
  });
  if (result.isErr()) throw new Error('Unable to share the presentation.');
}

/** The live transport; it fetches a fresh permission token on each connect. */
export function connectPresentationSync(
  documentId: string
): PresentationConnection {
  return createSyncServiceSource(documentId, undefined);
}
