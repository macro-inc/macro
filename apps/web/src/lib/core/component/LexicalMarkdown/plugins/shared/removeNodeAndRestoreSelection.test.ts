import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  createEditor,
  type LexicalEditor,
  ParagraphNode,
  TextNode,
} from 'lexical';
import { describe, expect, test } from 'vitest';
import { removeNodeAndRestoreSelection } from './removeNodeAndRestoreSelection';

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'remove-node-and-restore-selection-test',
    nodes: [ParagraphNode, TextNode],
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

describe('removeNodeAndRestoreSelection', () => {
  test('creates an empty paragraph when the root becomes empty', () => {
    const editor = createTestEditor();
    let paragraphKey = '';

    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode('remove me'));
        paragraphKey = paragraph.getKey();
        $getRoot().clear().append(paragraph);
      },
      { discrete: true }
    );

    removeNodeAndRestoreSelection(editor, paragraphKey);

    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children).toHaveLength(1);
      expect($isParagraphNode(children[0])).toBe(true);
      expect(children[0].getTextContent()).toBe('');

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.anchor.getNode().getTopLevelElement()?.getKey()).toBe(
        children[0].getKey()
      );
    });
  });

  test('selects an emptied paragraph instead of nesting a paragraph', () => {
    const editor = createTestEditor();
    let paragraphKey = '';
    let textKey = '';

    editor.update(
      () => {
        const text = $createTextNode('remove me');
        textKey = text.getKey();

        const paragraph = $createParagraphNode();
        paragraphKey = paragraph.getKey();
        paragraph.append(text);

        $getRoot().clear().append(paragraph);
      },
      { discrete: true }
    );

    removeNodeAndRestoreSelection(editor, textKey);

    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children).toHaveLength(1);
      expect(children[0].getKey()).toBe(paragraphKey);
      expect($isParagraphNode(children[0])).toBe(true);
      if (!$isParagraphNode(children[0])) return;
      expect(children[0].getChildrenSize()).toBe(0);

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.anchor.getNode().getKey()).toBe(paragraphKey);
      expect(selection.anchor.offset).toBe(0);
    });
  });

  test('does not create a nested update when called inside an update', () => {
    const editor = createTestEditor();
    let paragraphKey = '';

    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode('remove me'));
        paragraphKey = paragraph.getKey();
        $getRoot().clear().append(paragraph);
      },
      { discrete: true }
    );

    const originalUpdate = editor.update.bind(editor);
    let updateCalls = 0;
    editor.update = ((...args: Parameters<LexicalEditor['update']>) => {
      updateCalls++;
      return originalUpdate(...args);
    }) as LexicalEditor['update'];

    editor.update(
      () => {
        removeNodeAndRestoreSelection(editor, paragraphKey);
      },
      { discrete: true }
    );

    expect(updateCalls).toBe(1);
    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children).toHaveLength(1);
      expect($isParagraphNode(children[0])).toBe(true);
      expect(children[0].getTextContent()).toBe('');
    });
  });
});
