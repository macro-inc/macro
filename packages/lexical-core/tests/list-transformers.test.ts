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
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import {
  CUSTOM_TRANSFORMERS,
  ORDERED_LIST_ENTER,
} from '../transformers/customTransformers';
import {
  markdownToSerializedEditorStateWithIds,
  serializedEditorStateToMarkdown,
} from '../utils/markdown-state';

function makeEditor() {
  return createEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
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

function readOrderedList(editor: LexicalEditor) {
  return editor.getEditorState().read(() => {
    const [list] = $getRoot().getChildren();
    expect($isListNode(list)).toBe(true);
    if (!$isListNode(list)) {
      throw new Error('Expected converted node to be an ordered list');
    }
    return {
      listType: list.getListType(),
      start: list.getStart(),
      items: list.getChildren().map((item) => item.getTextContent()),
    };
  });
}

describe('custom ordered-list transformer', () => {
  it('keeps a non-1 start when replacing ListNode with TaskListNode', async () => {
    const editor = makeEditor();

    await update(editor, () => {
      $getRoot()
        .clear()
        .append($createListNode('number', 6).append($createListItemNode()));
    });

    expect(readOrderedList(editor)).toEqual({
      listType: 'number',
      start: 6,
      items: [''],
    });
  });

  it('starts a new list at the typed marker', async () => {
    const editor = makeEditor();

    await update(editor, () => {
      const paragraph = $createParagraphNode();
      const transformer = getCustomOrderedListTransformer();
      const match = '6. '.match(transformer.regExp);

      if (!match) {
        throw new Error('Expected ordered list marker to match');
      }

      $getRoot().clear().append(paragraph);
      transformer.replace(paragraph, [$createTextNode('Reply')], match, false);
    });

    expect(readOrderedList(editor)).toEqual({
      listType: 'number',
      start: 6,
      items: ['Reply'],
    });
  });

  it('starts a list at the typed marker on Enter without a trailing space', async () => {
    const editor = makeEditor();

    await update(editor, () => {
      const paragraph = $createParagraphNode();
      const match = '6.'.match(ORDERED_LIST_ENTER.regExp);

      if (!match) {
        throw new Error('Expected bare ordered list marker to match');
      }

      $getRoot().clear().append(paragraph);
      ORDERED_LIST_ENTER.replace(paragraph, [], match, false);
    });

    expect(readOrderedList(editor)).toEqual({
      listType: 'number',
      start: 6,
      items: [''],
    });
  });

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

    expect(readOrderedList(editor)).toEqual({
      listType: 'number',
      start: 1,
      items: ['Incoming', 'Existing'],
    });
  });

  it('imports and exports a markdown list that starts after 1', () => {
    const state = markdownToSerializedEditorStateWithIds('6. Reply');
    const [list] = state.root.children;

    expect(list).toMatchObject({
      type: 'task-list',
      listType: 'number',
      start: 6,
    });
    expect(serializedEditorStateToMarkdown(state)).toBe('6. Reply');
  });
});
