import { storageServiceClient } from '@service-storage/client';
import { refetchHistory } from '@service-storage/history';

/**
 * Track the opening of a document and refetch the history
 * For the sidebar
 * @param documentId - The id of the document to track
 * @param refetch - Whether to refetch the history
 */
export function trackOpenAndRefetchHistory(documentId: string, refetch = true) {
  storageServiceClient
    .trackOpenedDocument({
      documentId,
    })
    .then(() => {
      if (refetch) {
        refetchHistory();
      }
    })
    .catch((err) => console.error(err));
}
