import { throwOnErr } from '@core/util/result';
import { fetchDocumentLoadBundle } from '@queries/storage/documentLoad/documentLoadBundle';
import { createSyncServiceSource } from '@service-sync/source';
import { createRoot } from 'solid-js';
import { spreadsheetDraftUpdate } from '../core/draft-update';

/** Wait for durable acknowledgement before navigating away from the draft. */
export async function saveSpreadsheetDraft(
  documentId: string,
  snapshot: Uint8Array
): Promise<void> {
  const bundle = await throwOnErr(() => fetchDocumentLoadBundle(documentId));
  if (bundle.userAccessLevel !== 'owner' && bundle.userAccessLevel !== 'edit') {
    throw new Error('This spreadsheet is read-only.');
  }
  return createRoot((dispose) => {
    const { source, doInitialSync } = createSyncServiceSource(
      documentId,
      bundle.token
    );
    async function save() {
      try {
        const initial = await doInitialSync();
        if (initial.isErr())
          throw new Error('Could not connect to spreadsheet.');
        const { peerIds, update } = spreadsheetDraftUpdate(
          snapshot,
          initial.value.snapshot
        );
        for (const peerId of peerIds) source.registerPeerId(peerId);
        if (!(await source.pushUpdate([update]))) {
          throw new Error('Spreadsheet save was not acknowledged.');
        }
      } finally {
        source.cleanup();
        dispose();
      }
    }
    return save();
  });
}
