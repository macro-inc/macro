import { $createLinkNode } from '@lexical/link';
import {
  $createListItemNode,
  $createListNode,
  $isListNode,
} from '@lexical/list';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import {
  $convertMentionToCard,
  $isDocumentCardNode,
} from '../nodes/DocumentCardNode';
import { $createDocumentMentionNode } from '../nodes/DocumentMentionNode';

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

function createMention() {
  return $createDocumentMentionNode({
    documentId: 'doc-1',
    documentName: 'Doc',
    blockName: 'md',
  });
}

describe('$convertMentionToCard', () => {
  it('splits a paragraph around a mention nested in an inline parent', async () => {
    const editor = makeEditor();

    await update(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const link = $createLinkNode('https://example.com');
      const mention = createMention();

      root.clear();
      link.append(mention);
      paragraph.append(
        $createTextNode('before '),
        link,
        $createTextNode(' after')
      );
      root.append(paragraph);

      $convertMentionToCard(mention);
    });

    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren();

      expect(children).toHaveLength(3);
      expect(children[0].getTextContent()).toBe('before ');
      expect($isDocumentCardNode(children[1])).toBe(true);
      expect(children[2].getTextContent()).toBe(' after');
    });
  });

  it('splits a list around a mention-only list item', async () => {
    const editor = makeEditor();

    await update(editor, () => {
      const root = $getRoot();
      const list = $createListNode('bullet');
      const beforeItem = $createListItemNode();
      const mentionItem = $createListItemNode();
      const afterItem = $createListItemNode();
      const mention = createMention();

      root.clear();
      beforeItem.append($createTextNode('before'));
      mentionItem.append(mention);
      afterItem.append($createTextNode('after'));
      list.append(beforeItem, mentionItem, afterItem);
      root.append(list);

      $convertMentionToCard(mention);
    });

    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren();
      const beforeList = children[0];
      const afterList = children[2];

      expect(children).toHaveLength(3);
      expect($isListNode(beforeList)).toBe(true);
      expect($isDocumentCardNode(children[1])).toBe(true);
      expect($isListNode(afterList)).toBe(true);

      if (!$isListNode(beforeList) || !$isListNode(afterList)) {
        throw new Error('Expected lists around converted card');
      }

      expect(
        beforeList.getChildren().map((item) => item.getTextContent())
      ).toEqual(['before']);
      expect(
        afterList.getChildren().map((item) => item.getTextContent())
      ).toEqual(['after']);
    });
  });

  it('keeps list-item text before and after the converted mention in lists', async () => {
    const editor = makeEditor();

    await update(editor, () => {
      const root = $getRoot();
      const list = $createListNode('bullet');
      const beforeItem = $createListItemNode();
      const mentionItem = $createListItemNode();
      const afterItem = $createListItemNode();
      const mention = createMention();

      root.clear();
      beforeItem.append($createTextNode('before'));
      mentionItem.append(
        $createTextNode('item before '),
        mention,
        $createTextNode(' item after')
      );
      afterItem.append($createTextNode('after'));
      list.append(beforeItem, mentionItem, afterItem);
      root.append(list);

      $convertMentionToCard(mention);
    });

    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren();
      const beforeList = children[0];
      const afterList = children[2];

      expect(children).toHaveLength(3);
      expect($isListNode(beforeList)).toBe(true);
      expect($isDocumentCardNode(children[1])).toBe(true);
      expect($isListNode(afterList)).toBe(true);

      if (!$isListNode(beforeList) || !$isListNode(afterList)) {
        throw new Error('Expected lists around converted card');
      }

      expect(
        beforeList.getChildren().map((item) => item.getTextContent())
      ).toEqual(['before', 'item before ']);
      expect(
        afterList.getChildren().map((item) => item.getTextContent())
      ).toEqual([' item after', 'after']);
    });
  });
});
