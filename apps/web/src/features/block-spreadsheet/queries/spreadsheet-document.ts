import { ThrownResultError } from '@core/util/result';
import { fetchSyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context';

/** Load authorization and metadata once; the mounted view owns the live source. */
export async function loadSpreadsheetDocument(documentId: string) {
  const result = await fetchSyncDocumentOpenContext(documentId);
  if (result.isErr()) {
    throw new ThrownResultError(
      result.error.map((error) => ({
        ...error,
        code: error.code === 'MISSING' ? 'NOT_FOUND' : error.code,
      }))
    );
  }
  return result.value;
}

export type SpreadsheetDocumentData = Awaited<
  ReturnType<typeof loadSpreadsheetDocument>
>;
