import type { CanvasFile } from '../core/document-format';

/** The document session only needs permission and a completed JSON write. */
export type CanvasDocumentSource = {
  canEdit: () => boolean;
  save: (file: CanvasFile) => Promise<Blob>;
};
