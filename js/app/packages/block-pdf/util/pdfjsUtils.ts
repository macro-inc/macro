import type { Color, IColor } from '@block-pdf/model/Color';
import {
  Highlight,
  HighlightRect,
  HighlightType,
  type WH,
} from '@block-pdf/model/Highlight';
import { PageModel } from '@block-pdf/model/Page';
import type { PDFViewer } from '@block-pdf/PdfViewer';
import type { ThreadPayload } from '@block-pdf/type/comments';
// import {
//   type Annotation,
//   AnnotationFlag,
//   AnnotationType,
//   type QuadCoord,
//   type Rect,
// } from '@block-pdf/type/pdfJs';
// import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { v7 as uuid7 } from 'uuid';

// const MARGIN_Y_PERCENT = 0.12;
// const MARGIN_Y_MIN = 4;
// const MARGIN_X = 1;
// const PARTIAL_MARGIN_LEFT = 3;
// const PARTIAL_MARGIN_RIGHT = 0;

// type TextRect = TextItem & {
//   rawStr: [string, number][];
//   rect: Rect;
// };

// Normalize rectangle rect=[x1, y1, x2, y2] so that (x1,y1) < (x2,y2)
// For coordinate systems whose origin lies in the bottom-left, this
// means normalization to (BL,TR) ordering. For systems with origin in the
// top-left, this means (TL,BR) ordering.
export function normalizeRect<
  T extends [x1: number, y1: number, x2: number, y2: number],
>(rect: T): T {
  const r = rect.slice(0) as T; // clone rect
  if (rect[0] > rect[2]) {
    r[0] = rect[2];
    r[2] = rect[0];
  }
  if (rect[1] > rect[3]) {
    r[1] = rect[3];
    r[3] = rect[1];
  }
  return r;
}

// function intersect_compare(a: number, b: number) {
//   return a - b;
// }

// function intersects(rect1: Rect, rect2: Rect): boolean {
//   // Order points along the axes
//   const orderedX = [rect1[0], rect1[2], rect2[0], rect2[2]].sort(
//     intersect_compare
//   );
//   const orderedY = [rect1[1], rect1[3], rect2[1], rect2[3]].sort(
//     intersect_compare
//   );
//
//   return (
//     // X: first and second points belong to different rectangles?
//     ((orderedX[0] === rect1[0] && orderedX[1] === rect2[0]) ||
//       (orderedX[0] === rect2[0] && orderedX[1] === rect1[0])) &&
//     // Y: first and second points belong to different rectangles?
//     ((orderedY[0] === rect1[1] && orderedY[1] === rect2[1]) ||
//       (orderedY[0] === rect2[1] && orderedY[1] === rect1[1]))
//   );
// }

// function quadToRect(quad: QuadCoord): Rect {
//   const x = quad.map((q) => q.x);
//   const y = quad.map((q) => q.y);
//   return [Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)];
// }

// function rectContainsY(container: Rect, target: Rect): boolean {
//   const MARGIN_Y = Math.max(
//     MARGIN_Y_MIN,
//     (container[3] - container[1]) * MARGIN_Y_PERCENT
//   );
//   return (
//     container[1] - MARGIN_Y <= target[1] && container[3] + MARGIN_Y >= target[3]
//   );
// }

// function rectContainsX(container: Rect, target: Rect): boolean {
//   return (
//     container[0] - MARGIN_X <= target[0] && container[2] + MARGIN_X >= target[2]
//   );
// }

// function rectContains(container: Rect, target: Rect) {
//   return rectContainsX(container, target) && rectContainsY(container, target);
// }

// function extractPartialText(annotRect: Rect, textRect: TextRect) {
//   const str: string[] = [];
//   const x1 = annotRect[0];
//   const x2 = annotRect[2];
//   const { rawStr, rect, width } = textRect;
//   if (rawStr == null || rawStr.length === 0) return '';
//
//   // The scale dim isn't correctly reported from pdf.js
//   const xScale = width / rawStr[rawStr.length - 1][1];
//   const x1Offset = rawStr[0][1];
//   const x2Offset = rect[0];
//   for (let [glyph, g_x1] of rawStr) {
//     // The glyph advance (g_x1) is the right side of the character
//     const g_x2 = g_x1 * xScale + x2Offset;
//     if (g_x2 + PARTIAL_MARGIN_RIGHT >= x2) break;
//     if (g_x2 - x1Offset + PARTIAL_MARGIN_LEFT >= x1) {
//       str.push(glyph);
//     }
//   }
//   return str.join('');
// }

function domRectContains(container: DOMRect, target: DOMRect) {
  return (
    container.top <= target.top &&
    container.bottom >= target.bottom &&
    container.left <= target.left &&
    container.right >= target.right
  );
}

function seekParentWithClass(
  childEl: HTMLElement | null,
  className: string
): HTMLElement | null {
  let res = childEl;
  while (!res?.classList?.contains(className) && res?.parentElement != null) {
    res = res.parentElement;
  }
  return res;
}

function sortAndFilterDOMRects(rects: DOMRect[] | DOMRectList) {
  return Array.from(rects)
    .filter((x) => x.width && x.height)
    .sort((a, b) => a.top - b.top + (a.height - b.height) + (a.width - b.width))
    .filter((_, i, y) => y[i + 1] == null || !domRectContains(y[i + 1], y[i]));
}

function mergeHighlightRects(rects: HighlightRect[]): HighlightRect[] {
  // Merge rects that are on the same line and right next to each other
  const sortedRects = rects.sort(HighlightRect.sortedOrder);
  const mergedRects: HighlightRect[] = [];
  let lastRect: HighlightRect | null = null;
  sortedRects.forEach((rect) => {
    if (lastRect && HighlightRect.isAdjacent(lastRect, rect)) {
      lastRect.width = HighlightRect.right(rect) - lastRect.left;
    } else {
      if (lastRect) {
        mergedRects.push(lastRect);
      }
      lastRect = rect;
    }
  });
  if (lastRect) {
    mergedRects.push(lastRect);
  }

  return mergedRects;
}

function cleanupHighlightText(text: string): string {
  return text
    .replace(/[\r\n]/g, ' ')
    .trim()
    .replace(/[ ]{2,}/g, ' ');
}

/** assumes that padding is flush with the bounds of the text layer, it's highly unlikely they are exactly at the page boundary */
function isPaddingBounds(container: DOMRect, target: DOMRect) {
  const x1 = Math.floor(container.left);
  const x2 = Math.floor(container.right);
  const t_x1 = Math.floor(target.left);
  const t_x2 = Math.floor(target.right);
  return t_x1 <= x1 || t_x2 >= x2;
}

function mergedRectsFromDOMRects(textLayer: HTMLElement, rects: DOMRect[]) {
  const textLayerRect = textLayer.getBoundingClientRect();
  const domRects = sortAndFilterDOMRects(
    rects.filter((target) => !isPaddingBounds(textLayerRect, target))
  );
  return mergeHighlightRects(
    domRects.map((domRect) => highlightRectFromDOM(domRect, textLayerRect))
  );
}

function highlightRectFromDOM(
  selectionRect: DOMRect,
  pageRect: DOMRect
): HighlightRect {
  const top = (selectionRect.top - pageRect.top) / pageRect.height;
  const left = (selectionRect.left - pageRect.left) / pageRect.width;
  const width = selectionRect.width / pageRect.width;
  const height = selectionRect.height / pageRect.height;
  return new HighlightRect(top, left, width, height);
}

function htmlCollectionToString(collection: HTMLCollection): string {
  const result: string[] = [];
  for (let node of collection) {
    switch (node.nodeName) {
      case 'BR':
        result.push(' ');
        break;
      case 'SPAN':
        if (node.textContent != null) result.push(node.textContent);
        break;
      default:
        result.push(htmlCollectionToString(node.children));
        break;
    }
  }

  return result.join(' ');
}

function rangeToString(range: Range): string {
  const contents = range.cloneContents();

  if (contents.children.length > 0)
    return htmlCollectionToString(contents.children);
  else return contents.textContent ?? '';
}

function textNodeRects(_range: Range) {
  const range = _range.cloneRange();
  const iter = document.createNodeIterator(
    range.commonAncestorContainer,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: function () {
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let atStart = false;
  const result: DOMRect[] = [];
  var nodeRange = document.createRange();
  while (iter.nextNode()) {
    const { referenceNode: node } = iter;
    // skip until at the start of the range
    if (!atStart && node !== range.startContainer) continue;
    atStart = true;

    if (node.nodeType === Node.TEXT_NODE) {
      nodeRange.selectNodeContents(node);
      if (node === range.startContainer && node) {
        nodeRange.setStart(node, range.startOffset);
      }
      if (node === range.endContainer) {
        nodeRange.setEnd(node, range.endOffset);
      }

      if (!nodeRange.collapsed) result.push(nodeRange.getBoundingClientRect());
    }

    // Edge case handling for setting the end of triple-click selections
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      range.endContainer.nodeType === Node.ELEMENT_NODE &&
      !document.getSelection()?.containsNode(node)
    ) {
      nodeRange.setEnd(node, 0);
      break;
    }

    // stop at the end of the range
    if (node === range.endContainer) break;
  }

  return result;
}

function rangeToHighlightByPageIndex(
  range: Range,
  text: string,
  selectionParams: {
    color: Color | IColor | null;
    thread: ThreadPayload | null;
    redact: boolean;
    pageViewport?: WH;
  }
): Map<number, Highlight> {
  const startNode = range.startContainer as HTMLElement | null;
  const endNode = range.endContainer as HTMLElement | null;
  const pages = new Map<number, Highlight>();
  if (startNode == null || endNode == null) return pages;

  const startPage = PageModel.getPageNode(startNode);
  const endPage = PageModel.getPageNode(endNode);
  if (startPage == null || endPage == null) return pages;

  const startIndex = PageModel.getPageIndex(startPage)!;
  const endIndex = PageModel.getPageIndex(endPage)!;

  // the difficult case is when the selection is across pages, the bounding rects include
  // all of the elements in subsequent pages between the start and the end containers
  const startTextLayer = seekParentWithClass(startNode, 'textLayer');
  const endTextLayer = seekParentWithClass(endNode, 'textLayer');

  if (startTextLayer == null || endTextLayer == null) return pages;

  if (startNode === endNode || startPage === endPage) {
    // the easy case is when the start and end containers belong to the same text layer
    pages.set(
      startIndex,
      new Highlight({
        uuid: uuid7(),
        pageNum: startIndex,
        rects: mergedRectsFromDOMRects(startTextLayer, textNodeRects(range)),
        type: HighlightType.HIGHLIGHT,
        text: cleanupHighlightText(text),
        ...selectionParams,
      })
    );

    return pages;
  }

  const startRangeTexts: string[] = [];
  const rects: DOMRect[] = [];

  const startRange = range.cloneRange();
  const textLayer = startPage.querySelector('.textLayer');
  if (
    textLayer == null ||
    textLayer.firstElementChild == null ||
    textLayer.lastElementChild == null
  )
    return pages;
  startRange.setEndAfter(textLayer.lastElementChild);

  rects.push(...textNodeRects(startRange));
  startRangeTexts.unshift(startRange.toString());
  startRange.detach();

  pages.set(
    startIndex,
    new Highlight({
      uuid: uuid7(),
      pageNum: startIndex,
      rects: mergedRectsFromDOMRects(startTextLayer, rects),
      type: HighlightType.HIGHLIGHT,
      text: cleanupHighlightText(startRangeTexts.join(' ')),
      ...selectionParams,
    })
  );

  // Assume everything in the pages between the start and end are highlighted
  const docView = seekParentWithClass(startNode, 'pdfViewer');
  if (docView == null || startIndex == null || endIndex == null) {
    console.error('the pdfViewer class is missing on the document container');
  } else {
    docView.querySelectorAll('.page[data-page-number]').forEach((page) => {
      const pageIndex = PageModel.getPageIndex(page as HTMLElement);
      if (pageIndex == null || pageIndex <= startIndex || pageIndex >= endIndex)
        return;

      const textLayer = page.querySelector('.textLayer');
      if (
        textLayer == null ||
        textLayer.firstElementChild == null ||
        textLayer.lastElementChild == null
      )
        return;
      const pageRange = document.createRange();
      pageRange.setStart(
        textLayer.firstElementChild,
        textLayer.firstElementChild.childNodes.length
      );
      pageRange.setEnd(
        textLayer.lastElementChild,
        textLayer.lastElementChild.childNodes.length
      );
      pages.set(
        pageIndex,
        new Highlight({
          uuid: uuid7(),
          pageNum: pageIndex,
          rects: mergedRectsFromDOMRects(
            textLayer as HTMLElement,
            textNodeRects(pageRange)
          ),
          type: HighlightType.HIGHLIGHT,
          text: cleanupHighlightText(rangeToString(pageRange)),
          ...selectionParams,
        })
      );
      pageRange.detach();
    });
  }

  // Chromium correctly selects only the text contents at the end of ranges, but not the start
  if (endTextLayer?.firstElementChild != null) {
    const endRange = range.cloneRange();
    endRange.setStart(endTextLayer?.firstElementChild, 0);
    pages.set(
      endIndex,
      new Highlight({
        uuid: uuid7(),
        pageNum: endIndex,
        rects: mergedRectsFromDOMRects(
          endTextLayer as HTMLElement,
          textNodeRects(endRange)
        ),
        type: HighlightType.HIGHLIGHT,
        text: cleanupHighlightText(rangeToString(endRange)),
        ...selectionParams,
      })
    );
    endRange.detach();
  }

  return pages;
}

// export function highlightsFromPDFjs({
//   pageIndex,
//   pageViewport,
//   textContent,
//   annotations,
// }: {
//   pageIndex: number;
//   pageViewport: WH;
//   textContent: TextContent;
//   annotations: Annotation[];
// }): Highlight[] {
//   const { height, width } = pageViewport;
//   const pageRect = normalizeRect([0, 0, width, height]);
//
//   const results: Highlight[] = [];
//   const textRects: TextRect[] = (textContent.items as TextItem[]).map(
//     (text) => {
//       const x = text.transform[4];
//       const y = text.transform[5];
//       return {
//         ...text,
//         rect: normalizeRect([x, y, x + text.width, y + text.height]),
//       } as TextRect;
//     }
//   );
//
//   // Organize all highlight threads
//   let threads: Array<Thread> = new Array<Thread>();
//   for (let annot of annotations) {
//     if (
//       (annot.annotationType !== AnnotationType.HIGHLIGHT &&
//         annot.annotationType !== AnnotationType.UNDERLINE &&
//         annot.annotationType !== AnnotationType.STRIKEOUT) ||
//       annot.inReplyTo != null ||
//       !annot.contentsObj?.str
//     )
//       continue;
//     let newThread = new Thread(annot.id, pageIndex);
//     newThread.isResolved = annot.annotationFlags === AnnotationFlag.HIDDEN;
//     let editDate: Date = reformatPdfjsDate(
//       annot.modificationDate,
//       annot.creationDate
//     );
//     newThread.comments.push({
//       id: annot.id,
//       sender: annot.titleObj?.str ?? '',
//       content: annot.contentsObj.str,
//       editDate,
//     });
//     threads.push(newThread);
//   }
//   for (let annot of annotations) {
//     if (!annot.contentsObj?.str) continue;
//     const index = threads.findIndex((t) => t.headID === annot.inReplyTo);
//     if (index > -1) {
//       let editDate: Date = reformatPdfjsDate(
//         annot.modificationDate,
//         annot.creationDate
//       );
//       threads[index].comments.push({
//         id: annot.id,
//         sender: annot.titleObj?.str ?? '',
//         content: annot.contentsObj.str,
//         editDate,
//       });
//     }
//   }
//
//   for (let annot of annotations) {
//     if (
//       (annot.annotationType !== AnnotationType.HIGHLIGHT &&
//         annot.annotationType !== AnnotationType.UNDERLINE &&
//         annot.annotationType !== AnnotationType.STRIKEOUT) ||
//       annot.inReplyTo != null
//     )
//       continue;
//     if (annot.quadPoints == null || annot.quadPoints.length === 0) continue;
//
//     let type: (typeof HighlightType)[keyof typeof HighlightType] =
//       HighlightType.HIGHLIGHT;
//     if (annot.annotationType === AnnotationType.UNDERLINE)
//       type = HighlightType.UNDERLINE;
//     if (annot.annotationType === AnnotationType.STRIKEOUT)
//       type = HighlightType.STRIKEOUT;
//
//     const color =
//       annot.color == null
//         ? type === HighlightType.UNDERLINE
//           ? this.defaultGreen
//           : type === HighlightType.STRIKEOUT
//             ? this.defaultRed
//             : this.defaultYellow
//         : type === HighlightType.UNDERLINE || type === HighlightType.STRIKEOUT
//           ? new Color(annot.color[0], annot.color[1], annot.color[2], 1)
//           : new Color(annot.color[0], annot.color[1], annot.color[2], 0.4);
//
//     const rects = annot.quadPoints
//       .map(quadToRect)
//       .filter((x) => rectContains(pageRect, x)); // sometimes annotations are out-of-bounds
//
//     let thread: Thread | undefined = threads.find((t) => t.headID === annot.id);
//
//     const str: string[] = [];
//
//     for (let annotRect of rects) {
//       for (let textRect of textRects) {
//         if (intersects(annotRect, textRect.rect)) {
//           if (rectContains(annotRect, textRect.rect)) {
//             if (textRect.hasEOL) str.push(' ');
//             str.push(textRect.str);
//           } else if (rectContainsY(annotRect, textRect.rect)) {
//             if (textRect.hasEOL) str.push(' ');
//             str.push(extractPartialText(annotRect, textRect));
//           }
//         }
//       }
//     }
//
//     const highlight = new Highlight({
//       uuid: uuid7(),
//       pageNum: pageIndex,
//       // highlight coordinates are expected to be relative to the page dimensions and top/left
//       rects: rects.map(
//         (rect) =>
//           new HighlightRect(
//             (height - rect[1] - (rect[3] - rect[1])) / height,
//             rect[0] / width,
//             (rect[2] - rect[0]) / width,
//             (rect[3] - rect[1]) / height
//           )
//       ),
//       pageViewport,
//       color,
//       type,
//       thread,
//       text: str
//         .join('')
//         .trim()
//         .replace(/[ ]{2,}/g, ' '),
//     });
//
//     results.push(highlight);
//   }
//
//   return results;
// }

/** @returns Map of page index to highlights on that page */
export function getHighlightsFromSelection(
  selection: Selection,
  color: Color | IColor | null = null,
  type: (typeof HighlightType)[keyof typeof HighlightType] = HighlightType.HIGHLIGHT,
  thread: ThreadPayload | null = null,
  redact: boolean = false,
  pageViewport?: WH
): Map<number, Highlight> {
  const range = selection.getRangeAt(0);
  const text = selection.toString();
  const startNode = selection.getRangeAt(0)
    .startContainer as HTMLElement | null;
  const startPage = PageModel.getPageNode(startNode);

  // seek up to the pdfViewer, which is the top-level ancestor for all pages, so that picture-in-picture
  //   // has a valid bounding rect not based on the top-level page
  const docView = seekParentWithClass(startPage, 'pdfViewer');

  if (docView == null) {
    return new Map();
  }

  const selectionParams = {
    color,
    type,
    thread,
    redact,
    pageViewport,
  };

  return rangeToHighlightByPageIndex(range, text, selectionParams);
}

/**
 * Get the bounding rect of a page in the pdf viewer
 * @param viewer
 * @param pageNum 1-based index of the page
 */
export const getPdfPageRect = (
  args: { pageNum: number } & (
    | { viewer: PDFViewer }
    | { viewerEl: HTMLElement }
  )
) => {
  let viewerEl: HTMLElement;
  if ('viewer' in args) {
    viewerEl = args.viewer.viewerElement() as HTMLElement;
  } else {
    viewerEl = args.viewerEl;
  }

  const pdfPageRect = viewerEl
    .querySelector(`[data-page-number="${args.pageNum}"] .pageOverlayContainer`)
    ?.getBoundingClientRect();
  return pdfPageRect;
};
