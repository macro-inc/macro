import { throwOnErr } from '@core/util/result';
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
  const exported = await throwOnErr(() =>
    storageServiceClient.exportDocument({ documentId })
  );
  const bytes = await fetchPresigned(exported.presigned_url, 'arrayBuffer');
  if (bytes.isErr())
    throw new Error(
      `Unable to download the exported document: ${bytes.error[0]?.message}`
    );
  return new Uint8Array(bytes.value);
}
