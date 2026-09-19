import type { IModificationData } from '@block-pdf/type/coParse';
import type { IPlaceable } from '@block-pdf/type/placeables';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { batch, untrack } from 'solid-js';
import { reconcile } from 'solid-js/store';
import { usePdfDocument } from '../context/pdf-document-context';
import { annotationsToPlaceables } from './placeables';

export const useLoadAnnotations = () => {
  const pdfDocument = usePdfDocument();
  const [, setModificationData] = pdfDocument.state.stores.modificationData;
  const [serverModificationData] =
    pdfDocument.state.signals.serverModificationData;
  const hasServerModificationData = () => serverModificationData() != null;

  // const getPageHighlightMap = (highlights: IHighlight[]): HighlightUuidMap => {
  //   const pageIndex = highlights.at(0)?.pageNum;
  //   if (pageIndex === undefined) return {};
  //   if (!highlights.every((h) => h.pageNum === pageIndex)) return {};
  //
  //   // NOTE: deduplicates highlights by uuid, preferring the last highlight in the array
  //   const hmap = highlights.reduce<HighlightUuidMap>(
  //     (acc, h) => ({ ...acc, [h.uuid]: h }),
  //     {}
  //   );
  //
  //   return hmap;
  // };

  return async (
    documentProxy: PDFDocumentProxy,
    modificationData: IModificationData
  ) => {
    // clearHighlightStore();

    if (hasServerModificationData()) {
      batch(() => {
        // setHighlightStore(reconcile(modificationData.highlights));
        setModificationData(
          'placeables',
          reconcile(untrack(() => modificationData.placeables))
        );
      });
      return;
    }

    setModificationData('placeables', reconcile([]));
    // const allHighlights: [number, HighlightUuidMap][] = [];
    const allPlaceables: IPlaceable[] = [];
    for (let pageIndex = 0; pageIndex < documentProxy.numPages; pageIndex++) {
      try {
        const page = await documentProxy.getPage(pageIndex + 1);

        const pageViewport = page.getViewport({ scale: 1 });
        const [annotations, _textContent] = await Promise.all([
          page.getAnnotations(),
          new Promise((resolve) => resolve(null)),
          // page.getTextContent(),
        ]);

        // const highlightArray = highlightsFromPDFjs({
        //   pageIndex,
        //   pageViewport,
        //   textContent,
        //   annotations,
        // }).map(Highlight.toObject);
        //
        // if (highlightArray.length > 0) {
        //   const highlightsOnPage = getPageHighlightMap(highlightArray);
        //   allHighlights.push([pageIndex, highlightsOnPage]);
        // }

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

    batch(() => {
      // for (const [pageIndex, highlightsOnPage] of allHighlights) {
      //   setHighlightStore(pageIndex, highlightsOnPage);
      // }
      setModificationData('placeables', reconcile(allPlaceables));
    });
  };
};
