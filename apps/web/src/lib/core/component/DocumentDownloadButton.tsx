import { createFileDownload } from '@core/util/createFileDownload';
import { storedDocumentDownloadSource } from '@queries/storage/document-download';
import { FileDownloadButton } from './FileDownload';

/** Downloads a linked file without opening its viewer or loading it on hover. */
export function DocumentDownloadButton(props: { documentId: string }) {
  const download = createFileDownload(() =>
    storedDocumentDownloadSource(props.documentId)
  );
  return <FileDownloadButton download={download} iconOnly />;
}
