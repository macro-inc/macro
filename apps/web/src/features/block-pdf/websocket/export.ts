import type {
  Export,
  ExportResponseData,
} from '@coparse/document-processing-types';
import { blockAcceptedFileExtensionToMimeType } from '@core/constant/allBlocks';
import { type EphemeralFile, makeFile } from '@filesystem/file';
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
      const blob = await fetchBinary(data.resultUrl, 'blob');
      if (blob.isErr()) {
        console.error('unable to retrieve blob', blob.error);
        return undefined;
      }
      return blob.value;
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
