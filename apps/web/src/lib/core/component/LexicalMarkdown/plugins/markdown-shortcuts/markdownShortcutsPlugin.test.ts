import { $isListNode, ListItemNode } from '@lexical/list';
import { CODE } from '@lexical/markdown';
import { registerRichText } from '@lexical/rich-text';
import {
  NodeReplacements,
  ORDERED_LIST_ENTER,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import { HR } from '@macro-inc/lexical-core/transformers/transformers';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { markdownShortcutsPlugin } from './markdownShortcutsPlugin';

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'markdown-shortcuts-ordered-list-test',
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError: (error) => {
      throw error;
    },
  });

  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
  editor.setRootElement(root);
  registerRichText(editor);
  markdownShortcutsPlugin({
    transformers: [ORDERED_LIST_ENTER],
    triggerOnEnterTransformers: [HR, CODE, ORDERED_LIST_ENTER],
  })(editor);

  return editor;
}

describe('markdownShortcutsPlugin ordered lists', () => {
  it('starts a numbered list at the typed marker on Enter', () => {
    const editor = createTestEditor();

    editor.update(
      () => {
        const text = $createTextNode('6.');
        $getRoot().clear().append($createParagraphNode().append(text));
        text.select(2, 2);
      },
      { discrete: true }
    );

    editor.dispatchCommand(
      KEY_ENTER_COMMAND,
      new KeyboardEvent('keydown', { key: 'Enter' })
    );

    editor.read(() => {
      const [list] = $getRoot().getChildren();
      expect($isListNode(list)).toBe(true);
      if (!$isListNode(list)) {
        throw new Error('Expected Enter on 6. to create an ordered list');
      }
      expect(list.getListType()).toBe('number');
      expect(list.getStart()).toBe(6);
      expect(list.getChildrenSize()).toBe(1);
      expect(list.getFirstChild()?.getType()).toBe(ListItemNode.getType());
    });
  });
});
