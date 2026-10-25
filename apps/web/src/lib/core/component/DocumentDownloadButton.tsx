import { createFileDownload } from '@core/util/createFileDownload';
import { catchToResult } from '@core/util/result';
import {
  getFileDocumentBlob,
  loadFileDocumentData,
} from '@queries/storage/file-document';
import { formatDocumentName } from '@service-storage/util/filename';
import { FileDownloadButton } from './FileDownload';

/** Downloads a linked file without opening its viewer or loading it on hover. */
export function DocumentDownloadButton(props: { documentId: string }) {
  const download = createFileDownload(() => {
    const documentId = props.documentId;
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
  });
  return <FileDownloadButton download={download} iconOnly />;
}
