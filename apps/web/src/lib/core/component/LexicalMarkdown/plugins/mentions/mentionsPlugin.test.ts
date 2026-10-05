import {
  $convertMentionToCard,
  $createDocumentCardNode,
  $createDocumentMentionNode,
  $isDocumentMentionNode,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $getRoot,
  $isElementNode,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import { type ItemMention, mentionsPlugin } from './mentionsPlugin';

// The plugin's imports reach the realtime connection, which opens a socket on load.
vi.hoisted(() => {
  class FakeWebSocket {
    url: string;
    readyState = 1;
    constructor(url: string) {
      this.url = url;
    }
    close() {}
    addEventListener() {}
    removeEventListener() {}
    send() {}
  }
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

vi.mock('@core/signal/mention', () => ({
  untrackMention: vi.fn(),
}));

function composer() {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  editor.setRootElement(document.createElement('div'));
  const created: ItemMention[] = [];
  const removed: ItemMention[] = [];
  mentionsPlugin({
    onCreateMention: (mention) => created.push(mention),
    onRemoveMention: (mention) => removed.push(mention),
  })(editor);
  return { editor, created, removed };
}

function discrete(editor: LexicalEditor, change: () => void) {
  editor.update(change, { discrete: true });
}

describe('mentionsPlugin', () => {
  it('reports a document card put into a composer as a reference, and its removal', () => {
    const { editor, created, removed } = composer();
    discrete(editor, () => {
      $getRoot().append(
        $createDocumentCardNode({
          documentId: 'form-1',
          documentName: 'Lunch poll',
          blockName: 'form',
        })
      );
    });
    expect(created).toEqual([
      { itemType: 'form', itemId: 'form-1', documentName: 'Lunch poll' },
    ]);
    discrete(editor, () => $getRoot().clear());
    expect(removed).toEqual([{ itemType: 'form', itemId: 'form-1' }]);
  });

  it('keeps a mention referenced when it turns into a card', () => {
    const { editor, created, removed } = composer();
    discrete(editor, () => {
      const paragraph = $createParagraphNode();
      paragraph.append(
        $createDocumentMentionNode({
          documentId: 'form-1',
          documentName: 'Lunch poll',
          blockName: 'form',
        })
      );
      $getRoot().append(paragraph);
    });
    discrete(editor, () => {
      const node = $getRoot()
        .getChildren()
        .flatMap((child) => ($isElementNode(child) ? child.getChildren() : []))
        .find($isDocumentMentionNode);
      if (!node) throw new Error('no mention');
      $convertMentionToCard(node);
    });
    const references = (list: ItemMention[]) =>
      list.filter((item) => item.itemId === 'form-1').length;
    expect(references(created) - references(removed)).toBe(1);
  });

  it('leaves other cards’ sharing as it was: only form cards are references here', () => {
    const { editor, created } = composer();
    discrete(editor, () => {
      $getRoot().append(
        $createDocumentCardNode({
          documentId: 'document-1',
          documentName: 'Plan',
          blockName: 'md',
        })
      );
    });
    expect(created).toEqual([]);
  });
});
