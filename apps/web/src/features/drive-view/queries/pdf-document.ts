import PdfJsWorker from '@block-pdf/PdfViewer/pdfjs-worker?worker';
import { throwOnErr } from '@core/util/result';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import type { GetDocumentResponseDataViewLocation } from '@service-storage/generated/schemas/getDocumentResponseDataViewLocation';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

export type PdfDocumentData = {
  documentMetadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
  documentProxy: PDFDocumentProxy;
  viewLocation?: GetDocumentResponseDataViewLocation;
};

export async function loadPdfDocument(
  documentId: string
): Promise<PdfDocumentData> {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  if (!GlobalWorkerOptions.workerPort) {
    GlobalWorkerOptions.workerPort = new PdfJsWorker();
  }

  const data = await throwOnErr(() => fetchBinaryDocumentData(documentId));
  const blob = await throwOnErr(() => fetchBinary(data.blobUrl, 'blob'));
  const task = getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    isEvalSupported: false,
  });

  return {
    documentMetadata: data.documentMetadata,
    userAccessLevel: data.userAccessLevel,
    documentProxy: await task.promise,
    viewLocation: data.viewLocation,
  };
}
