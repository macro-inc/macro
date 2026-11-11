import type { DownloadSource } from '@core/util/createFileDownload';
import { catchToResult } from '@core/util/result';
import { downloadExportedDocument } from '@service-storage/util/downloadExportedDocument';
import { formatDocumentName } from '@service-storage/util/filename';
import { getFileDocumentBlob, loadFileDocumentData } from './file-document';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * An uploaded document's latest stored file under its own name and
 * extension, fetched without opening its viewer.
 */
export function storedDocumentDownloadSource(
  documentId: string
): DownloadSource {
  return {
    id: documentId,
    name: 'download',
    load: (options) =>
      catchToResult(async () => {
        const { documentMetadata } = await loadFileDocumentData(
          documentId,
          options
        );
        options.signal.throwIfAborted();
        return {
          blob: await getFileDocumentBlob(
            {
              documentId,
              documentVersionId: documentMetadata.documentVersionId,
            },
            options
          ),
          name: formatDocumentName(
            documentMetadata.documentName || 'download',
            documentMetadata.fileType,
            { caseInsensitiveSuffix: true }
          ),
        };
      }),
  };
}

/**
 * A Word document as document storage rebuilds it from its stored parts,
 * named like the Word editor's own download.
 */
export function exportedDocxDownloadSource(
  documentId: string,
  documentName: string
): DownloadSource {
  return {
    id: documentId,
    name: formatDocumentName(documentName || 'Document', 'docx', {
      caseInsensitiveSuffix: true,
    }),
    load: () =>
      catchToResult(async () => {
        const bytes = await downloadExportedDocument({ documentId });
        return { blob: new Blob([bytes.slice().buffer], { type: DOCX_MIME }) };
      }),
  };
}
