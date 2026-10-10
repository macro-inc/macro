import { authoredMentions } from '@channel/Input/message-payload';
import { untrackMention } from '@core/signal/mention';
import {
  $convertCardToMention,
  $convertMentionToCard,
  $createDocumentCardNode,
  $createDocumentMentionNode,
  $isDocumentCardNode,
  $isDocumentMentionNode,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import {
  INSERT_DOCUMENT_MENTION_COMMAND,
  type ItemMention,
  mentionsPlugin,
} from './mentionsPlugin';

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

function composer(expandDatabaseMentions = false) {
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
    expandDatabaseMentions,
    sourceDocumentId: 'doc-1',
    onCreateMention: (mention) => created.push(mention),
    onRemoveMention: (mention) => removed.push(mention),
  })(editor);
  return { editor, created, removed };
}

function discrete(editor: LexicalEditor, change: () => void) {
  editor.update(change, { discrete: true });
}

describe('mentionsPlugin', () => {
  it('expands a newly mentioned database in document bodies and preserves surrounding text', () => {
    const { editor, created } = composer(true);
    discrete(editor, () => {
      const text = $createTextNode('Before. After.');
      $getRoot().append($createParagraphNode().append(text));
      text.select(8, 8);
      editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
        documentId: 'db-1',
        documentName: 'Tasks',
        blockName: 'database',
      });
    });
    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children.map((child) => child.getType())).toEqual([
        'paragraph',
        'document-card',
        'paragraph',
      ]);
      expect(children[0].getTextContent()).toBe('Before. ');
      expect(children[2].getTextContent()).toBe('After.');
    });
    expect(created).toContainEqual({
      itemType: 'database',
      itemId: 'db-1',
      documentName: 'Tasks',
    });
  });

  it('keeps database mentions compact in composers', () => {
    const { editor } = composer();
    discrete(editor, () => {
      $getRoot().append($createParagraphNode()).selectEnd();
      editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
        documentId: 'db-1',
        documentName: 'Tasks',
        blockName: 'database',
      });
    });
    editor.read(() =>
      expect($getRoot().getFirstDescendant()?.getType()).toBe(
        'document-mention'
      )
    );
  });

  it('keeps the tracked database reference through collapse/expand and untracks only its removal', () => {
    vi.mocked(untrackMention).mockClear();
    const { editor, created, removed } = composer(true);
    discrete(editor, () => {
      $getRoot().append(
        $createDocumentCardNode({
          documentId: 'db-1',
          documentName: 'Tasks',
          blockName: 'database',
          mentionUuid: 'reference-1',
          blockParams: { tableId: 'table-1', viewId: 'view-1' },
        })
      );
    });
    discrete(editor, () => {
      const card = $getRoot().getFirstChild();
      if (!$isDocumentCardNode(card)) throw new Error('Missing card');
      const mention = $convertCardToMention(card);
      expect(mention.getBlockParams()).toEqual({
        tableId: 'table-1',
        viewId: 'view-1',
      });
    });
    discrete(editor, () => {
      const mention = $getRoot().getFirstDescendant();
      if (!$isDocumentMentionNode(mention)) throw new Error('Missing mention');
      const card = $convertMentionToCard(mention);
      expect(card.getMentionUuid()).toBe('reference-1');
    });
    expect(untrackMention).not.toHaveBeenCalled();
    expect(created.length - removed.length).toBe(1);
    discrete(editor, () => $getRoot().clear());
    expect(untrackMention).toHaveBeenCalledExactlyOnceWith(
      'doc-1',
      'reference-1'
    );
  });
  it('sends an inline form mention as a form reference, and drops it when the mention is removed', () => {
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
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createDocumentMentionNode({
            documentId: 'form-1',
            documentName: 'Workshop ideas',
            blockName: 'form',
          })
        );
        $getRoot().append(paragraph);
      },
      { discrete: true }
    );
    expect(created).toEqual([
      {
        itemType: 'form',
        itemId: 'form-1',
        fileType: 'form',
        documentName: 'Workshop ideas',
        channelType: undefined,
      },
    ]);
    expect(authoredMentions(created)).toEqual([
      { entity_type: 'form', entity_id: 'form-1' },
    ]);
    editor.update(() => $getRoot().clear(), { discrete: true });
    expect(removed).toEqual([{ itemType: 'form', itemId: 'form-1' }]);
  });

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
