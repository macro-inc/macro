import {
  type FileDocumentData,
  loadFileDocumentData,
} from '@queries/storage/file-document';

export type UnknownDocumentData = FileDocumentData;

export function loadUnknownDocument(
  documentId: string
): Promise<UnknownDocumentData> {
  return loadFileDocumentData(documentId);
}
