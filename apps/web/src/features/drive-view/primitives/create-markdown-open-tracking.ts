import { type Accessor, createEffect, on } from 'solid-js';

/** Record an open only when the authorized result belongs to the active detail. */
export function createMarkdownOpenTracking(options: {
  documentId: Accessor<string>;
  loadedDocumentId: Accessor<string | undefined>;
  recordOpen: (documentId: string) => void;
}) {
  let currentId: string | undefined;
  let recorded = false;

  createEffect(
    on(
      [options.documentId, options.loadedDocumentId],
      ([documentId, loadedDocumentId]) => {
        if (currentId !== documentId) {
          currentId = documentId;
          recorded = false;
        }
        if (recorded || loadedDocumentId !== documentId) return;

        recorded = true;
        options.recordOpen(documentId);
      }
    )
  );
}
