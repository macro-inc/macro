import { loroSyncState } from '@core/component/LexicalMarkdown/utils';
import {
  $createDocumentCardNode,
  $isDocumentCardNode,
  $updateAllNodeIds,
  DocumentCardNode,
  type NodeIdMappings,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type SerializedEditorState,
  type SerializedLexicalNode,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import { $reconcileLexicalState } from './reconcile';

// The editor utilities pull in the plugin barrel, whose leaves open the
// storage and connection-gateway sockets on import.
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

type SerializedParagraph = SerializedLexicalNode & {
  children: (SerializedLexicalNode & { text: string })[];
};

describe('$reconcileLexicalState', () => {
  it('applies removals, reorders, and runs of new paragraphs in one pass', () => {
    const editor = createEditor({
      namespace: 'reconcile',
      onError: (error) => {
        throw error;
      },
    });
    const mappings: NodeIdMappings = {
      idToNodeKeyMap: new Map(),
      nodeKeyToIdMap: new Map(),
    };
    editor.update(
      () => {
        for (const text of ['a', 'b', 'c', 'd', 'e']) {
          $getRoot().append(
            $createParagraphNode().append($createTextNode(text))
          );
        }
        $updateAllNodeIds(mappings);
      },
      { discrete: true }
    );
    const local = structuredClone(
      loroSyncState(editor.getEditorState())
    ) as SerializedEditorState;
    const [a, , c, d, e] = local.root.children as SerializedParagraph[];

    // Peers' new paragraphs, as Loro holds them: ids of their own.
    const added = (text: string, id: string): SerializedParagraph => ({
      ...structuredClone(a),
      $: { id },
      children: [
        { ...structuredClone(a.children[0]), $: { id: `${id}-text` }, text },
      ],
    });
    e.children[0].text = 'e edited';
    const remote: SerializedEditorState = {
      ...local,
      root: {
        ...local.root,
        children: [
          added('x', 'x'),
          added('y', 'y'),
          d,
          a,
          added('z', 'z'),
          e,
          c,
        ],
      },
    };
    const keysBefore = editor.read(() =>
      $getRoot()
        .getChildren()
        .map((node) => node.getKey())
    );

    editor.update(
      () =>
        $reconcileLexicalState(
          editor.getEditorState().toJSON(),
          remote,
          mappings,
          () => '1'
        ),
      { discrete: true }
    );

    expect(
      editor.read(() =>
        $getRoot()
          .getChildren()
          .map((node) => node.getTextContent())
      )
    ).toEqual(['x', 'y', 'd', 'a', 'z', 'e edited', 'c']);
    // Surviving paragraphs keep their nodes; `b` is gone.
    const keysAfter = editor.read(() =>
      $getRoot()
        .getChildren()
        .map((node) => node.getKey())
    );
    expect(keysAfter[2]).toBe(keysBefore[3]);
    expect(keysAfter[3]).toBe(keysBefore[0]);
    expect(keysAfter[5]).toBe(keysBefore[4]);
    expect(keysAfter[6]).toBe(keysBefore[2]);
    expect(keysAfter).not.toContain(keysBefore[1]);
  });

  it("applies a card's remote fields, so the next local write keeps them", () => {
    const editor = createEditor({
      namespace: 'reconcile-card',
      nodes: [DocumentCardNode],
      onError: (error) => {
        throw error;
      },
    });
    const mappings: NodeIdMappings = {
      idToNodeKeyMap: new Map(),
      nodeKeyToIdMap: new Map(),
    };
    editor.update(
      () => {
        $getRoot().append(
          $createDocumentCardNode({
            documentId: 'canvas-1',
            documentName: 'Canvas',
            blockName: 'canvas',
            previewData: { view: { x: 164, y: -687, scale: 100 } },
          })
        );
        $updateAllNodeIds(mappings);
      },
      { discrete: true }
    );
    const local = structuredClone(
      loroSyncState(editor.getEditorState())
    ) as SerializedEditorState;

    // Another person panned the embedded canvas and resized the card.
    const remote = structuredClone(local);
    const remoteCard = remote.root.children[0] as SerializedLexicalNode &
      Record<string, unknown>;
    remoteCard.previewData = { view: { x: 215, y: -3940, scale: 100 } };
    remoteCard.previewBox = ['100%', '600px'];
    remoteCard.blockParams = { view: 'board' };
    // A viewer without access to the canvas names it differently.
    remoteCard.documentName = 'No Access';

    editor.update(
      () =>
        $reconcileLexicalState(
          editor.getEditorState().toJSON(),
          remote,
          mappings,
          () => '1'
        ),
      { discrete: true }
    );

    editor.read(() => {
      const card = $getRoot().getFirstChild();
      if (!$isDocumentCardNode(card)) throw new Error('card missing');
      expect(card.getPreviewData()).toEqual(remoteCard.previewData);
      expect(card.getPreviewBox()).toEqual(remoteCard.previewBox);
      expect(card.getBlockParams()).toEqual(remoteCard.blockParams);
      expect(card.getDocumentName()).toBe('Canvas');
    });
    // What this editor writes next is what Loro already holds, apart from the
    // name it resolves for itself: it does not put its own earlier view back.
    expect(loroSyncState(editor.getEditorState()).root.children[0]).toEqual({
      ...remoteCard,
      documentName: 'Canvas',
    });
  });
});
