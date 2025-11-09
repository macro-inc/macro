import { blockAcceptedFileExtensionToMimeType } from '@core/constant/allBlocks';
import { type EphemeralFile, makeFile } from '@filesystem/file';
import type {
  Export,
  ExportResponseData,
} from '@macro-inc/document-processing-job-types';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { createWebSocketJob } from '@service-storage/websocket';

export function exportPdf({
  documentId,
  fileName,
}: {
  documentId: string;
  fileName: string;
}) {
  return createWebSocketJob<Blob, EphemeralFile, Export, ExportResponseData>({
    data: {
      documentId,
    },
    action: 'pdf_export',
    processResult: async (data) => {
      const [, blob] = await fetchBinary(data.resultUrl, 'blob');
      if (!blob) {
        console.error('unable to retrieve blob');
        return undefined;
      }
      return blob;
    },
    handleSuccess: async (blob) => {
      return makeFile({
        fileBits: [blob],
        handle: undefined,
        fileName,
        options: {
          type: blockAcceptedFileExtensionToMimeType['pdf'],
          lastModified: Date.now(),
        },
      });
    },
  });
}
