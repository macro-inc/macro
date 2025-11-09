import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { isErr, ok } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import { fetchBinary } from '@service-storage/util/fetchBinary';
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
        storageServiceClient.getBinaryDocument({
          documentId: source.id,
        })
      );

      if (intent === 'preload')
        return ok({
          type: 'preload',
          origin: source,
        });

      if (isErr(maybeDocument)) return maybeDocument;
      const [, { blobUrl, ...documentFile }] = maybeDocument;

      const maybeBlob = await loadResult(fetchBinary(blobUrl, 'blob'));
      if (isErr(maybeBlob)) return maybeBlob;

      const [, blob] = maybeBlob;

      const buffer = await blob.arrayBuffer();
      const data = new Uint8Array(buffer);
      const task = getDocument({ data });
      const documentProxy = await task.promise;

      return ok({
        ...documentFile,
        documentProxy,
      });
    }

    return LoadErrors.INVALID;
  },
});

export type PdfBlockData = ExtractLoadType<(typeof definition)['load']>;
