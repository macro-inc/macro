import {
  $createListItemNode,
  $createListNode,
  $isListNode,
} from '@lexical/list';
import { type ElementTransformer, ORDERED_LIST } from '@lexical/markdown';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { CUSTOM_TRANSFORMERS } from '../transformers/customTransformers';

function makeEditor() {
  return createEditor({
    nodes: SupportedNodeTypes,
    onError: console.error,
  });
}

function update(editor: LexicalEditor, fn: () => void): Promise<void> {
  return new Promise((resolve) => {
    editor.update(fn, { onUpdate: () => resolve() });
  });
}

function getCustomOrderedListTransformer(): ElementTransformer {
  const transformer = CUSTOM_TRANSFORMERS.find(
    (transformer): transformer is ElementTransformer =>
      transformer.type === 'element' &&
      transformer.regExp.source === ORDERED_LIST.regExp.source
  );

  if (!transformer) {
    throw new Error('Missing custom ordered list transformer');
  }

  return transformer;
}

describe('custom ordered-list transformer', () => {
  it('uses the incoming marker as the start when inserting before an ordered list', async () => {
    const editor = makeEditor();

    await update(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const list = $createListNode('number', 3);
      const existingItem = $createListItemNode();
      const transformer = getCustomOrderedListTransformer();
      const match = '1. '.match(transformer.regExp);

      if (!match) {
        throw new Error('Expected ordered list marker to match');
      }

      root.clear();
      existingItem.append($createTextNode('Existing'));
      list.append(existingItem);
      root.append(paragraph, list);

      transformer.replace(
        paragraph,
        [$createTextNode('Incoming')],
        match,
        false
      );
    });

    editor.getEditorState().read(() => {
      const [list] = $getRoot().getChildren();

      expect($isListNode(list)).toBe(true);
      if (!$isListNode(list)) {
        throw new Error('Expected converted node to be an ordered list');
      }

      expect(list.getListType()).toBe('number');
      expect(list.getStart()).toBe(1);
      expect(
        list.getChildren().map((item) => item.getTextContent())
      ).toEqual(['Incoming', 'Existing']);
    });
  });
});
