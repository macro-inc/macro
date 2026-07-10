/**
 * @vitest-environment jsdom
 */

import { $createQuoteNode, QuoteNode } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, test } from 'vitest';
import { $selectContentEnd } from '../utils/select-content-end';

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'select-content-end-test',
    nodes: [QuoteNode],
    onError: (error) => {
      throw error;
    },
  });

  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
  editor.setRootElement(root);

  return editor;
}

function expectCaretInBlock(editor: LexicalEditor, blockIndex: number) {
  editor.read(() => {
    const block = $getRoot().getChildren()[blockIndex];
    const selection = $getSelection();
    expect($isRangeSelection(selection)).toBe(true);
    if (!$isRangeSelection(selection)) return;
    expect(selection.isCollapsed()).toBe(true);
    expect(selection.anchor.getNode().getTopLevelElement()?.getKey()).toBe(
      block.getKey()
    );
  });
}

describe('$selectContentEnd', () => {
  test('appends an empty paragraph below a trailing quote and selects it', () => {
    const editor = createTestEditor();

    editor.update(
      () => {
        const quote = $createQuoteNode();
        quote.append($createTextNode('quoted message'));
        $getRoot().clear().append(quote);
        $selectContentEnd();
      },
      { discrete: true }
    );

    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children).toHaveLength(2);
      expect($isParagraphNode(children[1])).toBe(true);
      expect(children[1].getTextContent()).toBe('');
    });
    expectCaretInBlock(editor, 1);
  });

  test('keeps a trailing paragraph as-is and moves the caret to its end', () => {
    const editor = createTestEditor();

    editor.update(
      () => {
        const quote = $createQuoteNode();
        quote.append($createTextNode('quoted message'));
        const draft = $createParagraphNode();
        draft.append($createTextNode('draft'));
        $getRoot().clear().append(quote, draft);
        $selectContentEnd();
      },
      { discrete: true }
    );

    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children).toHaveLength(2);
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.anchor.offset).toBe('draft'.length);
    });
    expectCaretInBlock(editor, 1);
  });

  test('appends a paragraph to an empty root and selects it', () => {
    const editor = createTestEditor();

    editor.update(
      () => {
        $getRoot().clear();
        $selectContentEnd();
      },
      { discrete: true }
    );

    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children).toHaveLength(1);
      expect($isParagraphNode(children[0])).toBe(true);
    });
    expectCaretInBlock(editor, 0);
  });
});
