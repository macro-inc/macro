import { ENABLE_MENTION_TRACKING } from '@core/constant/featureFlags';
import type { CanvasDocumentSource } from '../context/document-source';
import type { CanvasFile } from '../core/document-format';
import { readCanvasFile } from '../core/document-format';
import { createTrackedCanvasDocumentSource } from '../primitives/create-tracked-document-source';
import { saveCanvasDocument } from './canvas-document';
import { canvasReferenceSource } from './references';

export function canvasDocumentSource(
  documentId: string,
  canEdit: () => boolean,
  initial: CanvasFile
): CanvasDocumentSource {
  const source: CanvasDocumentSource = {
    canEdit,
    async save(canvas) {
      if (!canEdit()) throw new Error('This canvas is read-only');
      const { file, saved } = await saveCanvasDocument(
        documentId,
        readCanvasFile(canvas)
      );
      if (!saved) throw new Error('Could not save canvas');
      return file;
    },
  };
  return ENABLE_MENTION_TRACKING
    ? createTrackedCanvasDocumentSource(
        documentId,
        initial,
        source,
        canvasReferenceSource(documentId)
      )
    : source;
}
