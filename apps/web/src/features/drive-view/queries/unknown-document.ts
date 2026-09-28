import { type FileDocumentData, loadFileDocumentData } from './file-document';

export type UnknownDocumentData = FileDocumentData;

export function loadUnknownDocument(
  documentId: string
): Promise<UnknownDocumentData> {
  return loadFileDocumentData(documentId);
}
