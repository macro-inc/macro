import { saveCanvasDocument } from '../../queries/canvas-document';
import type { CanvasDocumentSource } from '../context/document-source';
import { readCanvasFile } from '../core/document-format';

export function canvasDocumentSource(
  documentId: string,
  canEdit: () => boolean
): CanvasDocumentSource {
  return {
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
}
