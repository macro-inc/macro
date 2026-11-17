import { loadResult } from '@core/block';
import { storageServiceClient } from '@service-storage/client';

/** The document's metadata and the viewer's access; the pages load in the frame. */
export function loadArtifactDocument(documentId: string) {
  return loadResult(storageServiceClient.getDocumentMetadata({ documentId }));
}
