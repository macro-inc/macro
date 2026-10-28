import { createStore, produce } from 'solid-js/store';
import Term from '../model/Term';
import { decodeDefinitionText } from '../util/definitionText';
import { InvalidActionError } from '../util/errors';
import { estimateTextWidth } from '../util/estimateTextWidth';
import { XMLUtils } from '../util/XMLUtils';

const MIN_SIDE_PADDING = 20;
const WIDTH_PADDING = 50;
const MAX_LINES = 14;

class TermLexicon {
  readonly #terms = new Map<string, Term>();
  #loaded = false;

  get(id: string): Term | null {
    return this.#terms.get(id)?.clone() ?? null;
  }

  load(xml: string) {
    if (this.#loaded) return;

    const terms = XMLUtils.parse(xml).getElementsByTagName('term');
    for (const termNode of Array.from(terms).sort((a, b) => {
      const aId = a.getAttribute('id') || '';
      const bId = b.getAttribute('id') || '';
      return parseInt(aId) - parseInt(bId);
    })) {
      const id = termNode.getAttribute('id') || '';
      const term = new Term({
        id,
        name: termNode.getAttribute('name') || '',
        definition: termNode.getElementsByTagName('definition')[0],
        pageNum: parseInt(termNode.getAttribute('page') || ''),
        yPos: parseInt(termNode.getAttribute('y') || ''),
        numRefs:
          termNode
            .getElementsByTagName('references')[0]
            ?.getElementsByTagName('reference').length ?? 0,
        references: termNode
          .getElementsByTagName('references')[0]
          ?.getElementsByTagName('reference'),
        sims: termNode.getAttribute('sims')
          ? (termNode.getAttribute('sims') || '').trim().split(' ')
          : [],
      });
      this.#terms.set(id, term);
    }

    this.#loaded = true;
  }
}

function calculateSizing(
  term: Readonly<Term>,
  draft: DefinitionPopupState
): {
  width: number;
  truncated: boolean;
} {
  const text = Array.from(term.definition.childNodes)
    .filter((node) => node.nodeName.includes('span'))
    .map((element) => decodeDefinitionText(element as Element))
    .join('');

  const rowWidth = draft.pageWidth ?? 0;
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
    const numLinesWithTargetWidth = Math.ceil(singleLineWidth / targetWidth);
    if (numLinesWithTargetWidth <= targetLines) {
      width = targetWidth;
    } else {
      if (numLinesWithTargetWidth > 5) {
        targetLines += Math.ceil((numLinesWithTargetWidth - 5) / 2);
      }
      width = Math.min(
        maxWidth,
        (targetWidth * numLinesWithTargetWidth) / targetLines
      );
    }

    const estimatedLines = Math.ceil(singleLineWidth / width);
    width += WIDTH_PADDING;
    if (estimatedLines > MAX_LINES) {
      truncated = true;
    }
  }

  return {
    width,
    truncated,
  };
}

function updateTermIds(draft: DefinitionPopupState): void {
  draft.termIDs = [...new Set(draft.terms.map((term) => term.id))];
}

function updateTermSizing(draft: DefinitionPopupState): void {
  draft.termIDToSizingMap = Object.fromEntries(
    draft.terms.map((term) => [term.id, calculateSizing(term, draft)])
  );
}

export interface DefinitionPopupState {
  terms: Term[];
  termIDs: string[];
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

type SetRectsAction = {
  type: 'SET_RECTS';
  pageWidth: number;
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

type RemoveNextTermsAction = {
  type: 'REMOVE_NEXT_TERMS';
  index: number;
};

type RemovePopupsAction = {
  type: 'REMOVE_POPUPS';
};

export type DefinitionPopupAction =
  | SetTermAction
  | RemovePopupsAction
  | AddNextTermAction
  | RemoveNextTermsAction
  | SetTermFromElementAction
  | SetRectsAction;

function reducePopup(
  draft: DefinitionPopupState,
  action: DefinitionPopupAction
) {
  switch (action.type) {
    case 'SET_RECTS':
      draft.pageWidth = action.pageWidth;
      updateTermSizing(draft);
      break;
    case 'SET_TERM_FROM_ELEMENT':
      draft.pageWidth = action.pageWidth;
      draft.element = action.element;
      draft.terms = [action.term];
      updateTermIds(draft);
      updateTermSizing(draft);
      break;
    case 'SET_TERM':
      draft.terms = [action.term];
      updateTermIds(draft);
      updateTermSizing(draft);
      break;
    case 'ADD_NEXT_TERM':
      if (draft.terms.length === 0) {
        console.error(
          'Invalid state, cannot add term if there is not already a term'
        );
        return;
      }
      if (draft.termIDs.includes(action.term.id)) {
        return;
      }
      draft.terms.push(action.term);
      updateTermIds(draft);
      updateTermSizing(draft);
      break;
    case 'REMOVE_NEXT_TERMS': {
      const { index } = action;
      if (index === draft.terms.length - 1) {
        return;
      }
      if (index < 0 || index >= draft.terms.length) {
        console.error('Invalid term index provided');
      }
      draft.terms = draft.terms.slice(0, index + 1);
      updateTermIds(draft);
      updateTermSizing(draft);
      break;
    }
    case 'REMOVE_POPUPS':
      draft.terms = [];
      draft.pageWidth = null;
      draft.element = null;
      updateTermIds(draft);
      updateTermSizing(draft);
      break;
    default:
      throw new InvalidActionError(action);
  }
}

function createDefinitionPopupState(): DefinitionPopupState {
  return {
    terms: [],
    termIDs: [],
    termIDToSizingMap: {},
    pageWidth: null,
    element: null,
  };
}

function createDefinitionView(store: DefinitionPopupState) {
  return {
    terms: () => store.terms,
    element: () => store.element,
    termIDToSizingMap: () => store.termIDToSizingMap,
    pageWidth: () => store.pageWidth,
  };
}

export function createPdfDefinitions() {
  const [root, setRoot] = createStore(createDefinitionPopupState());
  const [popup, setPopup] = createStore(createDefinitionPopupState());
  const termData = new TermLexicon();

  const dispatchRoot = (action: DefinitionPopupAction) => {
    setRoot(
      produce<DefinitionPopupState>((state) => reducePopup(state, action))
    );
  };
  const dispatchPopup = (action: DefinitionPopupAction) => {
    setPopup(
      produce<DefinitionPopupState>((state) => reducePopup(state, action))
    );
  };

  return {
    root: createDefinitionView(root),
    popup: createDefinitionView(popup),
    getTerm: (id: string) => termData.get(id),
    commands: {
      dispatchRoot,
      dispatchPopup,
      loadTermXml: (xml: string) => {
        termData.load(xml);
      },
    },
  };
}

export type PdfDefinitions = ReturnType<typeof createPdfDefinitions>;
