import { saveCodeDocument } from '@block-code/queries/code-document';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';

export type CodeDocumentData = {
  text: string;
  documentMetadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
};

export async function loadCodeDocument(
  documentId: string
): Promise<CodeDocumentData> {
  return throwOnErr(() => storageServiceClient.getTextDocument({ documentId }));
}

export { saveCodeDocument };
