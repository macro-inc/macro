import PdfJsWorker from '@block-pdf/PdfViewer/pdfjs-worker?worker';
import type { PdfDocument } from '../context/contracts-context';

/** Sharpest backing bitmap we paint; larger ones cost memory for no gain. */
const MAX_PIXEL_RATIO = 2;

/**
 * Open PDF bytes for display. Rejects when the bytes are not a readable PDF.
 * pdf.js takes ownership of the buffer it is given, so it gets a copy.
 */
export async function openPdfDocument(
  bytes: ArrayBuffer
): Promise<PdfDocument> {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  if (!GlobalWorkerOptions.workerPort) {
    GlobalWorkerOptions.workerPort = new PdfJsWorker();
  }

  const pdf = await getDocument({
    data: new Uint8Array(bytes.slice(0)),
    isEvalSupported: false,
  }).promise;

  return {
    pageCount: pdf.numPages,

    async pageAspectRatio(page) {
      const viewport = (await pdf.getPage(page + 1)).getViewport({ scale: 1 });
      return viewport.width / viewport.height;
    },

    async renderPage(page, canvas, cssWidth) {
      const pdfPage = await pdf.getPage(page + 1);
      const unscaled = pdfPage.getViewport({ scale: 1 });
      const pixelRatio = Math.min(
        window.devicePixelRatio || 1,
        MAX_PIXEL_RATIO
      );
      const viewport = pdfPage.getViewport({
        scale: (cssWidth / unscaled.width) * pixelRatio,
      });

      const canvasContext = canvas.getContext('2d');
      if (!canvasContext) return;
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await pdfPage.render({ canvasContext, viewport }).promise;
    },
  };
}
