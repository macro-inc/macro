import { formatDocumentName } from '@service-storage/util/filename';

export function documentDownloadName(
  metadata: {
    documentName?: string | null;
    fileType?: string | null;
  },
  fallback = 'download'
) {
  return formatDocumentName(
    metadata.documentName || fallback,
    metadata.fileType,
    { caseInsensitiveSuffix: true }
  );
}
