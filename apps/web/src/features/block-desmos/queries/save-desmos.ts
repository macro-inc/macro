import { Telemetry } from '@macro-inc/observability';
import { storageServiceClient } from '@service-storage/client';
import {
  DESMOS_MIME,
  type GraphDocument,
  serializeDesmosDocument,
} from '../core/document';

export async function saveDesmosDocument(
  documentId: string,
  document: GraphDocument
): Promise<{ file: Blob; saved: boolean }> {
  return Telemetry.span('desmos.save', async (span) => {
    span.setAttr('document.id', documentId);
    const file = new Blob([serializeDesmosDocument(document)], {
      type: DESMOS_MIME,
    });
    const result = await storageServiceClient.simpleSave({
      documentId,
      file,
    });
    span.setAttr('desmos.outcome', result.isOk() ? 'saved' : 'error');
    return { file, saved: result.isOk() };
  });
}
