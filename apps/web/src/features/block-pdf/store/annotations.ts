import type { IPlaceable } from '@block-pdf/type/placeables';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { untrack } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import { annotationsToPlaceables } from './placeables';

export const useLoadAnnotations = () => {
  const model = usePdfDocument().model;

  return async (documentProxy: PDFDocumentProxy) => {
    if (model.hasServerSnapshot()) {
      model.commands.replacePlaceables(
        untrack(() => model.modificationData.placeables)
      );
      return;
    }

    model.commands.replacePlaceables([]);
    const allPlaceables: IPlaceable[] = [];
    for (let pageIndex = 0; pageIndex < documentProxy.numPages; pageIndex++) {
      try {
        const page = await documentProxy.getPage(pageIndex + 1);

        const pageViewport = page.getViewport({ scale: 1 });
        const annotations = await page.getAnnotations();

        const pagePlaceables = annotationsToPlaceables({
          pageIndex,
          annotations,
          pageViewport,
        });

        allPlaceables.push(...pagePlaceables);
      } catch (err) {
        console.error(err);
      }
    }

    model.commands.replacePlaceables(allPlaceables);
  };
};
