import { usePdfDocument } from '../context/pdf-document-context';

/**
 * Check if a user selection spans multiple pages of the pdf document.
 * @param {Selection} selection
 */
export function isMultiPageSelection(selection: Selection) {
  if (!selection || selection.rangeCount < 1) {
    return false;
  }
  const commonAncestor = selection.getRangeAt(0).commonAncestorContainer;
  if (!(commonAncestor instanceof HTMLElement)) {
    return false;
  }
  // If the selection crosses pdf pages, the only common ancestor will be be
  // the pdfViewer.
  return commonAncestor?.classList?.contains('pdfViewer') ?? false;
}

/**
 * Get the user-selcatable text contained in a pdf selection. The native
 * selection.toString() does not care about the `user-select: none` css
 * property.
 * @param {Selection} selection The selection.
 * @return {string} Extracted text – likely to write to clipboard.
 */
export function extractSelectionText(selection: Selection): string {
  const extractedText = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    const fragment = range.cloneContents();
    for (let node of fragment.childNodes) {
      extractedText.push(nodeToString(node));
    }
  }
  return extractedText.filter((item) => item !== '').join('\n');
}

function shouldIgnore(elem: Element): boolean {
  return (
    elem.classList.contains('pageOverlayContainer') ||
    elem.classList.contains('processedOverlayContainer')
  );
}

function nodeToString(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    if (shouldIgnore(node as Element)) {
      return '';
    }

    const text: string[] = [];
    for (let child of node.childNodes) {
      text.push(nodeToString(child));
    }
    return text.filter((item) => item !== '').join('\n');
  }
  return '';
}

export function useResetSelection() {
  const { signals, stores } = usePdfDocument().state;
  const setActiveHighlight = signals.activeHighlight[1];
  const setGeneralPopupLocation = signals.generalPopupLocation[1];
  const setSelection = stores.selection[1];

  return (selection?: Selection) => {
    selection?.removeAllRanges();
    setGeneralPopupLocation(null);
    setSelection({
      highlightsUnderSelection: [],
      selection: null,
      selectionString: '',
    });
    setActiveHighlight(null);
  };
}
