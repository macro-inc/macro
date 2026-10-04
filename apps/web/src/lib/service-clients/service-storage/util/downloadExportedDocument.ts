import { storageServiceClient } from '../client';
import { fetchPresigned } from './fetchPresigned';

/**
 * Download a document as document storage exports it, e.g. a Word document
 * rebuilt from its stored parts.
 */
export async function downloadExportedDocument({
  documentId,
}: {
  documentId: string;
}): Promise<Uint8Array> {
  const exported = await storageServiceClient.exportDocument({ documentId });
  if (exported.isErr()) throw new Error('Unable to export the document.');
  const bytes = await fetchPresigned(
    exported.value.presigned_url,
    'arrayBuffer'
  );
  if (bytes.isErr())
    throw new Error(
      `Unable to download the exported document: ${bytes.error[0]?.message}`
    );
  return new Uint8Array(bytes.value);
}
