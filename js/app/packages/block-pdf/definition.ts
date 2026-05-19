import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import type { GetDocumentResponseDataViewLocation } from '@service-storage/generated/schemas/getDocumentResponseDataViewLocation';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { err, ok } from 'neverthrow';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import BlockPdf from './component/Block';
import PdfJsWorker from './PdfViewer/pdfjs-worker?worker';

export const definition = defineBlock({
  name: 'pdf',
  description: 'work with pdf files',
  accepted: {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  component: BlockPdf,
  liveTrackingEnabled: true,
  async load(source, intent) {
    if (source.type === 'dss') {
      const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
      if (!GlobalWorkerOptions.workerPort)
        GlobalWorkerOptions.workerPort = new PdfJsWorker();

      const maybeDocument = await loadResult(
        fetchBinaryDocumentData(source.id)
      );

      if (intent === 'preload')
        return ok({
          type: 'preload',
          origin: source,
        });

      if (maybeDocument.isErr()) return err(maybeDocument.error);
      const { blobUrl, ...documentFile } = maybeDocument.value;

      const maybeBlob = await loadResult(fetchBinary(blobUrl, 'blob'));
      if (maybeBlob.isErr()) return err(maybeBlob.error);

      const blob = maybeBlob.value;

      const buffer = await blob.arrayBuffer();
      const data = new Uint8Array(buffer);
      const task = getDocument({ data, isEvalSupported: false });
      const documentProxy = await task.promise;

      return ok({
        ...documentFile,
        documentProxy,
      });
    }

    return LoadErrors.INVALID;
  },
});

export type PdfBlockData = ExtractLoadType<(typeof definition)['load']> & {
  documentProxy: PDFDocumentProxy;
  viewLocation?: GetDocumentResponseDataViewLocation;
};
