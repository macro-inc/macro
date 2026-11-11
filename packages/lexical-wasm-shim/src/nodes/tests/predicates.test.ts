import * as Original from 'lexical';
import { expect, test } from 'vitest';
import { $getRoot, createEditor } from '../../editor';
import { LineBreakNode, ParagraphNode, TabNode, TextNode } from '../index';
import * as Actual from '../predicates';

test('actual builtin categories and text modes preserve Original predicate results', () => {
  const original = Original.createEditor({
    onError(error) {
      throw error;
    },
  });
  let expected: unknown;
  original.update(
    () => {
      const root = Original.$getRoot();
      const paragraph = Original.$createParagraphNode();
      const text = Original.$createTextNode('text');
      const tab = Original.$createTabNode();
      const line = Original.$createLineBreakNode();
      expected = [root, paragraph, text, tab, line, null, undefined].map(
        (node) => [
          Original.$isLexicalNode(node),
          Original.$isRootNode(node),
          Original.$isTabNode(node),
          Original.$isDecoratorNode(node),
          Original.$isLeafNode(node),
        ]
      );
    },
    { discrete: true }
  );
  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  try {
    editor.update(() => {
      const root = $getRoot();
      const paragraph = new ParagraphNode();
      const text = new TextNode('text');
      const tab = new TabNode();
      const line = new LineBreakNode();
      expect(
        [root, paragraph, text, tab, line, null, undefined].map((node) => [
          Actual.$isLexicalNode(node),
          Actual.$isRootNode(node),
          Actual.$isTabNode(node),
          Actual.$isDecoratorNode(node),
          Actual.$isLeafNode(node),
        ])
      ).toEqual(expected);
      expect(Actual.$isRootOrShadowRoot(root)).toBe(true);
      expect(Actual.$isRootOrShadowRoot(paragraph)).toBe(false);
      expect(Actual.$isInlineElementOrDecoratorNode(paragraph)).toBe(false);
      expect(Actual.$isTokenOrTab(tab)).toBe(true);
      expect(Actual.$isTokenOrSegmented(text)).toBe(false);
      text.setMode('segmented');
      expect(Actual.$isTokenOrSegmented(text)).toBe(true);
    });
  } finally {
    editor.dispose();
  }
});
