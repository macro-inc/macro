import { toast } from '@core/component/Toast/Toast';
import { platformFetch } from '@core/util/platformFetch';
import { downloadFile } from '@filesystem/download';
import { storageServiceClient } from '@service-storage/client';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { exportPdf } from '../websocket/export';
import { doPrint } from './printUtil';

type PdfFileActionAuth = {
  isAuthenticated: boolean;
  openLogin: () => void;
};

function requireAuth(auth: PdfFileActionAuth) {
  if (auth.isAuthenticated) return true;
  auth.openLogin();
  return false;
}

async function pdfBytes(proxy: PDFDocumentProxy) {
  const data = (await proxy.getData()) as Uint8Array<ArrayBuffer>;
  return new Blob([data], { type: 'application/pdf' });
}

export async function printPdfDocument(
  auth: PdfFileActionAuth & { documentProxy: PDFDocumentProxy | undefined }
) {
  if (!requireAuth(auth)) return;
  const proxy = auth.documentProxy;
  if (!proxy) return;
  return doPrint(await pdfBytes(proxy));
}

export async function downloadPdfDocument(
  auth: PdfFileActionAuth & {
    documentProxy: PDFDocumentProxy | undefined;
    hasModifications: boolean;
    hasComments: boolean;
    documentId: string;
    fileName: string;
  }
) {
  if (!requireAuth(auth)) return;

  const proxy = auth.documentProxy;
  if (!proxy) return toast.failure('Unable to download file');

  const blob = await pdfBytes(proxy);
  const fileNameWithExtension = `${auth.fileName}.pdf`;

  try {
    // No need to export if there are no modifications.
    // Comments live outside the modification data, so they are handled separately.
    if (!auth.hasModifications && !auth.hasComments)
      return downloadFile(blob, fileNameWithExtension);

    const exportFile = await exportPdf({
      documentId: auth.documentId,
      fileName: auth.fileName,
    });
    downloadFile(exportFile, fileNameWithExtension);
  } catch (_) {
    try {
      downloadFile(blob, fileNameWithExtension);
    } catch (_) {
      toast.failure('Unable to download file');
    }
  }
}

export async function downloadDocxDocument(
  auth: PdfFileActionAuth & { documentId: string; fileName: string }
) {
  if (!requireAuth(auth)) return;

  const data = await storageServiceClient.exportDocument({
    documentId: auth.documentId,
  });
  if (data.isErr()) {
    return toast.failure('Unable to download file');
  }

  const fileNameWithExtension = `${auth.fileName}.docx`;

  try {
    const response = await platformFetch(data.value.presigned_url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const blob = new Blob([arrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    downloadFile(blob, fileNameWithExtension);
    toast.success('File downloaded successfully');
  } catch (error) {
    console.error('Download failed:', error);
    toast.failure('Failed to download file');
  }
}
