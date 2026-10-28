import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import Term from '../model/Term';
import { createPdfDefinitions, type PdfDefinitions } from './pdf-definitions';

vi.mock('../util/estimateTextWidth', () => ({
  estimateTextWidth: () => 100,
}));

function setup(): {
  definitions: PdfDefinitions;
  dispose: () => void;
} {
  return createRoot((dispose) => ({
    definitions: createPdfDefinitions(),
    dispose,
  }));
}

function createTerm(id: string, name = `Term ${id}`) {
  const document = new DOMParser().parseFromString(
    '<root><definition><span>Definition</span></definition></root>',
    'application/xml'
  );
  return new Term({
    id,
    name,
    definition: document.querySelector('definition')!,
    pageNum: 1,
    yPos: 20,
    numRefs: 0,
    references: document.getElementsByTagName('reference'),
    sims: [],
  });
}

const termXml = (id: string, name: string) => `
  <root>
    <term id="${id}" name="${name}" page="1" y="20">
      <definition><span>${name} definition</span></definition>
      <references />
    </term>
  </root>
`;

function popupSnapshot(
  popup: PdfDefinitions['root'] | PdfDefinitions['popup']
) {
  return {
    terms: popup.terms(),
    element: popup.element(),
    termIDToSizingMap: popup.termIDToSizingMap(),
    pageWidth: popup.pageWidth(),
  };
}

describe('createPdfDefinitions', () => {
  it('starts with independent empty root and popup state', () => {
    const { definitions, dispose } = setup();

    expect(definitions.root).not.toBe(definitions.popup);
    expect(popupSnapshot(definitions.root)).toEqual({
      terms: [],
      element: null,
      termIDToSizingMap: {},
      pageWidth: null,
    });
    expect(popupSnapshot(definitions.popup)).toEqual({
      terms: [],
      element: null,
      termIDToSizingMap: {},
      pageWidth: null,
    });
    dispose();
  });

  it('dispatches root and popup actions independently', () => {
    const { definitions, dispose } = setup();
    const rootElement = document.createElement('span');
    const popupElement = document.createElement('span');
    const first = createTerm('1');
    const second = createTerm('2');

    definitions.commands.dispatchRoot({
      type: 'SET_TERM_FROM_ELEMENT',
      term: first,
      pageWidth: 800,
      element: rootElement,
    });
    definitions.commands.dispatchRoot({
      type: 'ADD_NEXT_TERM',
      term: first,
    });
    definitions.commands.dispatchRoot({
      type: 'ADD_NEXT_TERM',
      term: second,
    });
    definitions.commands.dispatchPopup({
      type: 'SET_TERM_FROM_ELEMENT',
      term: second,
      pageWidth: 700,
      element: popupElement,
    });

    expect(popupSnapshot(definitions.root)).toEqual({
      terms: [first, second],
      element: rootElement,
      termIDToSizingMap: {
        '1': { width: 550, truncated: false },
        '2': { width: 550, truncated: false },
      },
      pageWidth: 800,
    });
    expect(popupSnapshot(definitions.popup)).toEqual({
      terms: [second],
      element: popupElement,
      termIDToSizingMap: {
        '2': { width: 550, truncated: false },
      },
      pageWidth: 700,
    });

    definitions.commands.dispatchRoot({
      type: 'REMOVE_NEXT_TERMS',
      index: 0,
    });
    expect(definitions.root.terms()).toEqual([first]);
    definitions.commands.dispatchRoot({ type: 'REMOVE_POPUPS' });

    expect(popupSnapshot(definitions.root)).toEqual({
      terms: [],
      element: null,
      termIDToSizingMap: {},
      pageWidth: null,
    });
    expect(definitions.popup.terms()).toEqual([second]);
    dispose();
  });

  it('shares cloned term lookup across root and popup state', () => {
    const { definitions, dispose } = setup();
    definitions.commands.loadTermXml(termXml('1', 'First'));

    const rootTerm = definitions.getTerm('1')!;
    const popupTerm = definitions.getTerm('1')!;
    definitions.commands.dispatchRoot({ type: 'SET_TERM', term: rootTerm });
    definitions.commands.dispatchPopup({ type: 'SET_TERM', term: popupTerm });

    expect(rootTerm).not.toBe(popupTerm);
    expect(definitions.root.terms()[0].id).toBe('1');
    expect(definitions.popup.terms()[0].id).toBe('1');
    rootTerm.name = 'Changed';
    expect(definitions.getTerm('1')?.name).toBe('First');
    dispose();
  });

  it('loads term XML once per authority', () => {
    const first = setup();
    const second = setup();

    first.definitions.commands.loadTermXml(termXml('1', 'First'));
    first.definitions.commands.loadTermXml(termXml('2', 'Ignored'));
    second.definitions.commands.loadTermXml(termXml('2', 'Second'));
    first.definitions.commands.dispatchRoot({
      type: 'SET_TERM',
      term: first.definitions.getTerm('1')!,
    });

    expect(first.definitions.getTerm('1')?.name).toBe('First');
    expect(first.definitions.getTerm('2')).toBeNull();
    expect(first.definitions.root.terms()).toHaveLength(1);
    expect(second.definitions.getTerm('1')).toBeNull();
    expect(second.definitions.getTerm('2')?.name).toBe('Second');
    expect(second.definitions.root.terms()).toEqual([]);
    first.dispose();
    second.dispose();
  });
});
