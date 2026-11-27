import { loroSyncState } from '@core/component/LexicalMarkdown/utils';
import {
  $createDocumentCardNode,
  $isDocumentCardNode,
  $updateAllNodeIds,
  DocumentCardNode,
  type NodeIdMappings,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $parseSerializedNode,
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

function firstEditedNode(state: SerializedEditorState): SerializedLexicalNode {
  const block = state.root.children[0];
  if (
    block.type === 'paragraph' &&
    'children' in block &&
    Array.isArray(block.children)
  ) {
    return block.children[0];
  }
  return block;
}

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

  const nodeEdits = [
    {
      type: 'document-mention',
      before: {
        documentId: 'doc-1',
        documentName: 'Local name',
        blockName: 'md',
        mentionUuid: 'mention-1',
      },
      remote: {
        documentName: 'No Access',
        blockParams: { heading: 'summary' },
        collapsed: true,
        mentionUuid: null,
      },
      local: { documentName: 'Local name', mentionUuid: undefined },
    },
    {
      type: 'user-mention',
      before: {
        userId: 'user-1',
        email: 'user@example.invalid',
        displayName: 'Cached name',
      },
      remote: { displayName: 'Other name', mentionUuid: 'mention-2' },
      local: { displayName: 'Cached name' },
    },
    {
      type: 'contact-mention',
      before: {
        contactId: 'contact-1',
        name: 'Old contact',
        emailOrDomain: 'contact@example.invalid',
        isCompany: false,
      },
      remote: { name: 'Updated contact', mentionUuid: 'mention-2' },
    },
    {
      type: 'tag-mention',
      before: {
        optionId: 'option-1',
        propertyDefinitionId: 'property-1',
        scope: 'user',
        name: 'Local tag',
        color: 'blue',
      },
      remote: {
        optionId: 'option-2',
        propertyDefinitionId: 'property-2',
        scope: 'team',
        name: 'Remote tag',
        color: 'red',
      },
      local: {
        propertyDefinitionId: 'property-1',
        scope: 'user',
        name: 'Local tag',
        color: 'blue',
      },
    },
    {
      type: 'snapshot',
      before: {
        documentId: 'doc-1',
        documentName: 'Old title',
        blockName: 'md',
        content: 'First snapshot',
        snapshotDate: '2026-01-01T00:00:00.000Z',
      },
      remote: {
        documentName: 'New title',
        content: 'Second snapshot',
        snapshotDate: '2026-01-02T00:00:00.000Z',
      },
    },
    {
      type: 'pr-mention',
      before: {
        id: 'pr-1',
        label: 'Locally resolved title',
        url: 'https://github.com/example/project/pull/1',
      },
      remote: {
        label: 'Remotely resolved title',
        url: 'https://github.com/example/other/pull/1',
        mentionUuid: 'mention-2',
      },
      local: {
        label: 'Locally resolved title',
        url: 'https://github.com/example/project/pull/1',
      },
    },
    {
      type: 'pr-mention',
      before: { id: '', url: 'https://github.com/example/project/pull/1' },
      remote: { url: 'https://github.com/example/project/pull/2' },
    },
    {
      type: 'pr-mention',
      before: { id: '', url: 'https://github.com/example/project/pull/1' },
      remote: { url: 'javascript:alert(1)' },
      local: { url: undefined },
    },
    {
      type: 'agent-session-mention',
      before: { id: 'session-1', label: 'Session', expanded: true },
      remote: { label: 'New session label', expanded: null },
      local: { expanded: undefined },
    },
    {
      type: 'booking-link-mention',
      before: {
        profileId: 'booking-1',
        slug: 'intro',
        label: 'Introduction',
      },
      remote: {
        slug: 'follow-up',
        label: 'Follow-up',
        url: 'https://macro.com/app/book/follow-up',
      },
    },
    {
      type: 'unknown-mention',
      before: { name: 'Unknown' },
      remote: { name: 'New label' },
    },
    {
      type: 'group-mention',
      before: { groupAlias: 'team' },
      remote: { groupAlias: 'everyone' },
    },
    {
      type: 'html-render',
      before: { html: '<p>Old content</p>', adaptColors: true },
      remote: { html: '<p>New content</p>', adaptColors: false },
    },
    {
      type: 'database-query',
      before: {
        queryId: 'answer-1',
        prompt: 'Count open items',
        displayMode: 'table',
        title: 'Open items',
        height: 240,
      },
      remote: {
        queryId: 'answer-2',
        prompt: 'Count items by status',
        displayMode: 'bar',
        chart: { x: 'status', y: ['count'] },
        title: null,
        height: 360,
      },
      local: { title: undefined },
    },
    {
      type: 'database-query',
      before: {
        queryId: 'answer-1',
        prompt: 'Count open items',
        displayMode: 'table',
      },
      remote: { queryId: null, displayMode: 'bar' },
      local: { queryId: 'answer-1', displayMode: 'table' },
    },
    {
      type: 'diff',
      before: { userId: 'agent-1', label: 'First suggestion' },
      remote: { userId: 'agent-2', label: 'Second suggestion' },
    },
    {
      type: 'diff-insert',
      before: { markdown: 'First draft' },
      remote: { markdown: 'Revised draft' },
    },
    {
      type: 'await',
      before: { awaitId: 'placeholder-1', text: 'Working' },
      remote: { text: 'Almost done' },
    },
    {
      type: 'paste',
      before: { content: 'First paste' },
      remote: { content: 'Updated paste' },
    },
    {
      type: 'equation',
      before: { equation: 'x+1', inline: true },
      remote: { equation: 'x+2' },
    },
  ];

  it.each(nodeEdits)(
    'keeps the $type fields on the next local write (%#)',
    ({ type, before, remote, local }) => {
      const editor = createEditor({
        namespace: 'reconcile-node-edit',
        nodes: [...SupportedNodeTypes],
        onError: (error) => {
          throw error;
        },
      });
      const mappings: NodeIdMappings = {
        idToNodeKeyMap: new Map(),
        nodeKeyToIdMap: new Map(),
      };
      let key: string | undefined;
      editor.update(
        () => {
          const node = $parseSerializedNode({ type, version: 1, ...before });
          key = node.getKey();
          $getRoot().append(
            node.isInline() ? $createParagraphNode().append(node) : node
          );
          $updateAllNodeIds(mappings);
        },
        { discrete: true }
      );
      const stored = structuredClone(loroSyncState(editor.getEditorState()));
      const target = firstEditedNode(stored);
      Object.assign(target, remote);

      editor.update(
        () =>
          $reconcileLexicalState(
            editor.getEditorState().toJSON(),
            stored,
            mappings,
            () => '1'
          ),
        { discrete: true }
      );

      editor.read(() => {
        const first = $getRoot().getFirstChild();
        const edited =
          first?.getType() === 'paragraph' && $isElementNode(first)
            ? first.getFirstChild()
            : first;
        expect(edited?.getKey()).toBe(key);
      });
      expect(firstEditedNode(loroSyncState(editor.getEditorState()))).toEqual({
        ...target,
        ...local,
      });
    }
  );
});
