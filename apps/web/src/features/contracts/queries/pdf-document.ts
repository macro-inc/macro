import PdfJsWorker from '@block-pdf/PdfViewer/pdfjs-worker?worker';
import { ResultAsync } from 'neverthrow';
import type { PDFPageProxy } from 'pdfjs-dist';
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

  // One paint at a time: scrolling fast through a long document queues
  // paints instead of starting them all, and stale ones drop out for free.
  let painting: Promise<void> = Promise.resolve();
  function inTurn(paint: () => Promise<void>): Promise<void> {
    const previous = painting;
    const next = (async () => {
      await ResultAsync.fromPromise(previous, () => undefined);
      await paint();
    })();
    painting = next;
    return next;
  }

  return {
    pageCount: pdf.numPages,

    async pageAspectRatio(page) {
      const viewport = (await pdf.getPage(page + 1)).getViewport({ scale: 1 });
      return viewport.width / viewport.height;
    },

    renderPage: (page, canvas, cssWidth, wanted) =>
      inTurn(async () => {
        if (!wanted()) return;
        const pdfPage = await pdf.getPage(page + 1);
        // The page can scroll away while it loads; no bitmap is made for it.
        if (!wanted()) return;
        await paintPage(pdfPage, canvas, cssWidth);
      }),

    async pageSize(page) {
      const viewport = (await pdf.getPage(page + 1)).getViewport({ scale: 1 });
      return { width: viewport.width, height: viewport.height };
    },

    paintPage: (page, canvas, pixelWidth) =>
      inTurn(async () => {
        const pdfPage = await pdf.getPage(page + 1);
        const unscaled = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({
          scale: pixelWidth / unscaled.width,
        });
        const canvasContext = canvas.getContext('2d');
        if (!canvasContext) return;
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await pdfPage.render({ canvasContext, viewport }).promise;
      }),

    async pageText(page) {
      const content = await (await pdf.getPage(page + 1)).getTextContent();
      return content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    },
  };
}

async function paintPage(
  pdfPage: PDFPageProxy,
  canvas: HTMLCanvasElement,
  cssWidth: number
): Promise<void> {
  const unscaled = pdfPage.getViewport({ scale: 1 });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  const viewport = pdfPage.getViewport({
    scale: (cssWidth / unscaled.width) * pixelRatio,
  });

  const canvasContext = canvas.getContext('2d');
  if (!canvasContext) return;
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await pdfPage.render({ canvasContext, viewport }).promise;
}
