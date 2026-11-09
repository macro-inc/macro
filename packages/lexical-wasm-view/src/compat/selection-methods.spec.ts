import * as Lexical from 'lexical';
import { expect, test } from 'vitest';
import { createUpstreamSelectionDOMMethods } from './upstream-selection-runtime';

test('applyDOMRange matches the original class over real source nodes and DOM', () => {
  const editor = Lexical.createEditor({
    onError(error) {
      throw error;
    },
  });
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.append(root);
  editor.setRootElement(root);
  try {
    editor.update(
      () => {
        Lexical.$getRoot().append(
          Lexical.$createParagraphNode().append(
            Lexical.$createTextNode('hello')
          )
        );
      },
      { discrete: true }
    );
    const methods = createUpstreamSelectionDOMMethods(Lexical);
    const text = root.querySelector('[data-lexical-text]')?.firstChild;
    if (!text) {
      throw new Error('Real reconciler did not produce a text DOM node');
    }
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 4);
    editor.update(
      () => {
        const expected = Lexical.$createRangeSelection();
        const actual = expected.clone();
        expected.applyDOMRange(range);
        methods.applyDOMRange(actual, range);
        expect(actual.is(expected)).toBe(true);
        expect(actual.anchor.type).toBe('text');
        expect(actual.anchor.offset).toBe(1);
        expect(actual.focus.offset).toBe(4);
        expect(actual.dirty).toBe(expected.dirty);
        expect(actual.getCachedNodes()).toEqual(expected.getCachedNodes());
      },
      { discrete: true }
    );
  } finally {
    editor.setRootElement(null);
    root.remove();
  }
});

test('character movement collapses both range directions like the original class', () => {
  const editor = Lexical.createEditor({
    onError(error) {
      throw error;
    },
  });
  const methods = createUpstreamSelectionDOMMethods(Lexical);
  editor.update(
    () => {
      const text = Lexical.$createTextNode('hello');
      Lexical.$getRoot().append(Lexical.$createParagraphNode().append(text));
      for (const [anchor, focus] of [
        [1, 4],
        [4, 1],
      ]) {
        for (const isBackward of [true, false]) {
          const initial = text.select(anchor, focus);
          const actual = initial.clone();
          const expected = initial.clone();
          expected.modify('move', isBackward, 'character');
          methods.modifyDOMSelection(actual, 'move', isBackward, 'character');
          expect(actual.is(expected)).toBe(true);
          expect(actual.isCollapsed()).toBe(true);
          expect(actual.dirty).toBe(expected.dirty);
        }
      }
    },
    { discrete: true }
  );
});
