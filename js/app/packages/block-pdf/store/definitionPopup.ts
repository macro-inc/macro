import { createBlockStore } from '@core/block';
import { produce } from 'solid-js/store';
import {
  decodeString,
  // LINE_HEIGHT,
  MAX_LINES,
} from '../component/DefinitionLookup/shared';
import type Term from '../model/Term';
import { InvalidActionError } from '../util/errors';
import { estimateTextWidth } from '../util/estimateTextWidth';

// packages/app/src/context/PopupContext.ts
/* --------------------------------------------------------------------------- *
 * Helper functions
 * --------------------------------------------------------------------------- */

const MIN_SIDE_PADDING = 20;
const WIDTH_PADDING = 50;

function calculateSizing(
  term: Readonly<Term>,
  draft: Partial<ISectionPopupContext>
): {
  width: number;
  truncated: boolean;
} {
  const text = Array.from(term.definition.childNodes)
    .filter((n) => n.nodeName.includes('span'))
    .map((el) => decodeString(el as Element))
    .join('');

  const { pageWidth } = draft;

  const rowWidth = pageWidth ?? 0;

  let width = 0;
  let truncated = false;

  const maxWidth = rowWidth - WIDTH_PADDING - 2 * MIN_SIDE_PADDING;
  const minWidth = Math.min(550, maxWidth);
  const targetWidth = Math.min(550, maxWidth);

  const singleLineWidth = estimateTextWidth(text);
  if (singleLineWidth < targetWidth) {
    width = Math.max(minWidth, singleLineWidth + WIDTH_PADDING);
  } else {
    let targetLines = 3;
    let numLinesWithTargetWidth = Math.ceil(singleLineWidth / targetWidth);
    if (numLinesWithTargetWidth <= targetLines) {
      width = targetWidth;
    } else {
      // If too many lines are needed to fit the target width, increase the width until
      // either the number of lines is below the target or the max width is reached
      if (numLinesWithTargetWidth > 5) {
        targetLines += Math.ceil((numLinesWithTargetWidth - 5) / 2);
      }
      width = Math.min(
        maxWidth,
        (targetWidth * numLinesWithTargetWidth) / targetLines
      );
    }

    const estimatedLines = Math.ceil(singleLineWidth / width);
    width = width + WIDTH_PADDING;
    if (estimatedLines > MAX_LINES) {
      truncated = true;
    }
  }

  return {
    width,
    truncated,
  };
}

function updateTermIDs(draft: Partial<ISectionPopupContext>): void {
  draft.termIDs = [...new Set(draft.terms?.map((term) => term.id))];
}

function updateTermIDToSizingMap(draft: Partial<ISectionPopupContext>): void {
  draft.termIDToSizingMap = Object.fromEntries(
    draft.terms?.map((term) => [term.id, calculateSizing(term, draft)]) ?? []
  );
}

/* --------------------------------------------------------------------------- *
 * Context
 * --------------------------------------------------------------------------- */

// TODO terms that are actually the same definition have different IDs
// As a result, you can open several of the same definition
interface ISectionPopupContext {
  terms: Term[];
  termIDs: Array<string>;
  termIDToSizingMap: Partial<
    Record<
      string,
      {
        width: number;
        truncated: boolean;
      }
    >
  >;

  pageWidth: number | null;
  element: Element | null;
}

const defaultState: ISectionPopupContext = {
  terms: [],
  termIDs: [],
  termIDToSizingMap: {},

  pageWidth: null,
  element: null,
};

type SetRectsAction = {
  type: 'SET_RECTS';
  pageWidth: number;
  // element: Element;
};

type SetTermAction = {
  type: 'SET_TERM';
  term: Term;
};

type SetTermFromElementAction = {
  type: 'SET_TERM_FROM_ELEMENT';
  term: Term;
  pageWidth: number;
  element: Element;
};

type AddNextTermAction = {
  type: 'ADD_NEXT_TERM';
  term: Term;
};

// Remove all terms after the specified index
type RemoveNextTermsAction = {
  type: 'REMOVE_NEXT_TERMS';
  index: number;
};

type RemovePopupsAction = {
  type: 'REMOVE_POPUPS';
};

type ISectionPopupAction =
  | SetTermAction
  | RemovePopupsAction
  | AddNextTermAction
  | RemoveNextTermsAction
  | SetTermFromElementAction
  | SetRectsAction;

const handler = (
  draft: Partial<ISectionPopupContext>,
  action: ISectionPopupAction
) => {
  switch (action.type) {
    case 'SET_RECTS':
      draft.pageWidth = action.pageWidth;
      // draft.element = action.element as unknown as Draft<Element>;

      updateTermIDToSizingMap(draft);

      break;
    case 'SET_TERM_FROM_ELEMENT':
      draft.pageWidth = action.pageWidth;
      draft.element = action.element;
      draft.terms = [action.term];
      updateTermIDs(draft);
      updateTermIDToSizingMap(draft);

      break;
    case 'SET_TERM':
      draft.terms = [action.term];
      updateTermIDs(draft);
      updateTermIDToSizingMap(draft);

      break;
    case 'ADD_NEXT_TERM':
      if (draft.terms?.length === 0) {
        console.error(
          'Invalid state, cannot add term if there is not already a term'
        );
        return;
      }

      if (draft.termIDs?.includes(action.term.id)) {
        return; // Do nothing
      }

      draft.terms?.push(action.term);
      updateTermIDs(draft);
      updateTermIDToSizingMap(draft);

      break;
    case 'REMOVE_NEXT_TERMS':
      const { index } = action;

      if (!draft.terms) {
        return;
      }

      if (index === draft.terms.length - 1) {
        // There are no next terms -> nothing to remove
        return;
      }

      if (index < 0 || index >= draft.terms.length) {
        console.error('Invalid term index provided');
      }

      draft.terms = draft.terms.slice(0, index + 1);
      updateTermIDs(draft);
      updateTermIDToSizingMap(draft);

      break;
    case 'REMOVE_POPUPS':
      draft.terms = [];

      // Clear rectangles
      draft.pageWidth = null;
      draft.element = null;

      updateTermIDs(draft);
      updateTermIDToSizingMap(draft);
      break;
    default:
      throw new InvalidActionError(action);
  }
};

const rootDefinitionStore = createBlockStore({ ...defaultState });
const popupDefinitionStore = createBlockStore({ ...defaultState });

export function usePopupContextUpdate(isPopup: boolean) {
  const setStore = isPopup ? popupDefinitionStore.set : rootDefinitionStore.set;

  return (action: ISectionPopupAction) => {
    setStore(produce((state) => handler(state, action)));
  };
}

export function usePopupStore(isPopup: boolean) {
  const store = isPopup ? popupDefinitionStore.get : rootDefinitionStore.get;

  return {
    terms: () => store.terms,
    element: () => store.element,
    termIDToSizingMap: () => store.termIDToSizingMap,
    pageWidth: () => store.pageWidth,
  };
}
