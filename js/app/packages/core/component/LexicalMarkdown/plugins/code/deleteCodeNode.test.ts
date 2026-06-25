import { SupportedNodeTypes } from '@lexical-core/node-list';
import { $createCustomCodeNode } from '@lexical-core/nodes/CustomCodeNode';
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
import { deleteCodeNode } from './deleteCodeNode';

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'delete-code-node-test',
    nodes: [...SupportedNodeTypes],
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

describe('deleteCodeNode', () => {
  test('replaces a sole code block with an empty paragraph', () => {
    const editor = createTestEditor();
    let codeKey = '';

    editor.update(
      () => {
        const code = $createCustomCodeNode();
        code.append($createTextNode('const value = 1;'));
        codeKey = code.getKey();
        $getRoot().clear().append(code);
        code.selectEnd();
      },
      { discrete: true }
    );

    deleteCodeNode(editor, codeKey);

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

  test('moves selection to the following block when deleting from the start', () => {
    const editor = createTestEditor();
    let codeKey = '';
    let nextParagraphKey = '';

    editor.update(
      () => {
        const code = $createCustomCodeNode();
        code.append($createTextNode('const value = 1;'));
        codeKey = code.getKey();

        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode('after'));
        nextParagraphKey = paragraph.getKey();

        $getRoot().clear().append(code, paragraph);
        code.selectEnd();
      },
      { discrete: true }
    );

    deleteCodeNode(editor, codeKey);

    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children).toHaveLength(1);
      expect(children[0].getKey()).toBe(nextParagraphKey);

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.anchor.getNode().getTopLevelElement()?.getKey()).toBe(
        nextParagraphKey
      );
      expect(selection.anchor.offset).toBe(0);
    });
  });
});
