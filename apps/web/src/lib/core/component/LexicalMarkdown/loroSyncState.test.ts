// @vitest-environment jsdom
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  $addSharedPeer,
  $createCommentNode,
  $createDocumentCardNode,
  $getLocal,
  $setId,
  $setLocal,
  $setPeerId,
  $updateAllNodeIds,
  CommentNode,
  type DocumentCardData,
  DocumentCardNode,
  LOCAL_STATUS_TAG,
  nodeIdPlugin,
} from '@macro-inc/lexical-core';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { serializedEditorStateToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $nodesOfType,
  createEditor,
  type NodeKey,
  ParagraphNode,
  type SerializedEditorState,
  TextNode,
} from 'lexical';
import { LoroMap, LoroMovableList } from 'loro-crdt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { $reconcileLexicalState } from './collaboration/reconcile';
import { documentMetadataPlugin } from './plugins/document-metadata/documentMetadataPlugin';
import { loroSyncState, recordChangedBlocks } from './utils';
import { MARKDOWN_VERSION_COUNTER } from './version';

vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ENABLE_MARKDOWN_SEARCH_TEXT: true,
}));

// utils.ts imports the plugin barrel, whose leaves open the storage and
// connection-gateway sockets on import.
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

type StoredBlock = { $?: { id?: string; searchText?: string } };
type StoredRoot = { $?: { documentMetadata?: { version?: number } } };
type LoroOp = { content: { key?: unknown; value?: unknown } };

let cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});

function newMappings() {
  return { idToNodeKeyMap: new Map(), nodeKeyToIdMap: new Map() };
}

function newEditor(mappings = newMappings()) {
  const editor = createEditor({
    nodes: [CommentNode, DocumentCardNode],
    onError: (error) => {
      throw error;
    },
  });
  cleanups.push(
    nodeIdPlugin({
      nodes: [ParagraphNode, TextNode, DocumentCardNode],
      mappings,
    })(editor),
    documentMetadataPlugin({})(editor)
  );
  return editor;
}

/** A body as the API stores it: node ids, and no searchText or version. */
function apiBody(
  paragraphs: string[],
  cards: DocumentCardData[] = []
): SerializedEditorState {
  const source = createEditor({
    nodes: [DocumentCardNode],
    onError: (error) => {
      throw error;
    },
  });
  source.update(
    () => {
      $getRoot().append(
        ...paragraphs.map((text) =>
          $createParagraphNode().append($createTextNode(text))
        ),
        ...cards.map($createDocumentCardNode)
      );
      $updateAllNodeIds(newMappings());
    },
    { discrete: true }
  );
  return source.getEditorState().toJSON();
}

/**
 * Opens `body` from a real Loro document and writes the editor's state the
 * way CollabProvider does: built against the stored state, comparing only the
 * blocks changed since the last write.
 */
async function openStored(
  body: SerializedEditorState | Uint8Array,
  editorBody?: SerializedEditorState
) {
  const manager: LoroManager = new LoroManager(MARKDOWN_LORO_SCHEMA, {
    documentId: 'document',
    ownsTelemetry: false,
  });
  cleanups.push(() => manager.dispose());
  const snapshot =
    body instanceof Uint8Array
      ? body
      : await serializedEditorStateToLoroSnapshot(body);
  if (!snapshot) throw new Error('no snapshot');
  expect((await manager.initializeFromSnapshot(snapshot)).isOk()).toBe(true);

  const stored = () =>
    manager.state?.state as unknown as SerializedEditorState | undefined;
  const mappings = newMappings();
  const editor = newEditor(mappings);
  editor.setEditorState(editor.parseEditorState(editorBody ?? stored()!));
  editor.update(() => $updateAllNodeIds(mappings), { discrete: true });

  let changed = new Set<NodeKey>();
  cleanups.push(
    editor.registerUpdateListener(
      ({ editorState, dirtyElements, dirtyLeaves }) =>
        recordChangedBlocks(editorState, dirtyElements, dirtyLeaves, changed)
    )
  );

  return {
    editor,
    manager,
    stored,
    receive(update: Uint8Array) {
      expect(manager.importUpdate(update).isOk()).toBe(true);
      editor.update(
        () => {
          $reconcileLexicalState(
            editor.getEditorState().toJSON(),
            stored()!,
            mappings,
            () => manager.peerIdStr
          );
        },
        { discrete: true, tag: 'from-loro' }
      );
    },
    async writeFromOldPeer(body: SerializedEditorState) {
      expect((await manager.syncToLoro(body as never)).isOk()).toBe(true);
    },
    /**
     * Registers a transform, as a plugin mounting after load does: Lexical then
     * marks every text node dirty, without changing it, in an update it commits
     * after the current task.
     */
    async markTextDirty() {
      cleanups.push(editor.registerNodeTransform(TextNode, () => {}));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(changed.size).toBeGreaterThan(0);
    },
    /** Writes the editor's state and returns the Loro ops it produced. */
    async write(options: { compareAll?: boolean } = {}) {
      const from = manager.doc.oplogVersion();
      const changedBlocks = options.compareAll ? undefined : changed;
      changed = new Set();
      const next = loroSyncState(editor.getEditorState(), {
        stored: stored(),
        changedBlocks,
      });
      expect((await manager.syncToLoro(next as never)).isOk()).toBe(true);
      return manager.doc
        .exportJsonUpdates(from)
        .changes.flatMap((change) => change.ops as LoroOp[]);
    },
    searchTexts() {
      const blocks = (stored()?.root.children ?? []) as StoredBlock[];
      return blocks.map((block) => block.$?.searchText);
    },
    version() {
      return (stored()?.root as StoredRoot | undefined)?.$?.documentMetadata
        ?.version;
    },
  };
}

function bodyWithCommentMarks(legacy: Array<boolean | undefined>) {
  const editor = createEditor({ nodes: [CommentNode] });
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      for (const [index, local] of legacy.entries()) {
        const mark = $createCommentNode({ ids: [`mark-${index}`] });
        $setId(mark, 'historical-mark');
        $setPeerId(mark, '1');
        $addSharedPeer(mark, '2');
        if (local !== undefined) $setLocal(mark, local);
        paragraph.append(mark.append($createTextNode('marked')));
      }
      paragraph.append($createTextNode(' trailing text'));
      $getRoot().append(
        paragraph,
        $createParagraphNode().append($createTextNode('other paragraph'))
      );
      $updateAllNodeIds(newMappings());
    },
    { discrete: true }
  );
  return editor.getEditorState().toJSON();
}

function physicalMarks(manager: LoroManager) {
  const blocks = manager.doc.getMap('root').get('children');
  if (!(blocks instanceof LoroMovableList)) throw new Error('Missing blocks');
  return blocks.toArray().flatMap((block) => {
    if (!(block instanceof LoroMap)) return [];
    const children = block.get('children');
    if (!(children instanceof LoroMovableList)) return [];
    return children.toArray().flatMap((node) => {
      if (!(node instanceof LoroMap) || node.get('type') !== 'comment-mark') {
        return [];
      }
      const metadata = node.get('$');
      if (!(metadata instanceof LoroMap)) throw new Error('Missing mark state');
      return [{ container: node.id, metadata: metadata.toJSON() }];
    });
  });
}

function localWrites(ops: LoroOp[]) {
  return ops.filter((op) => op.content.key === 'local');
}

describe('loroSyncState peer-local ownership', () => {
  it.each([undefined, true, false])(
    'keeps the stored local value (%s) across writes from different peers',
    async (legacyLocal) => {
      const first = await openStored(bodyWithCommentMarks([legacyLocal]));
      const second = await openStored(
        first.manager.doc.export({ mode: 'snapshot' })
      );
      first.manager.doc.setPeerId(1n);
      second.manager.doc.setPeerId(2n);

      for (const [peer, runtimeLocal] of [
        [first, true],
        [second, false],
      ] as const) {
        peer.editor.update(
          () => $setLocal($nodesOfType(CommentNode)[0], runtimeLocal),
          { discrete: true, tag: LOCAL_STATUS_TAG }
        );
      }

      for (const [writer, receiver, runtimeLocal] of [
        [first, second, true],
        [second, first, false],
        [first, second, true],
      ] as const) {
        expect(await writer.write({ compareAll: true })).toEqual([]);

        writer.editor.update(
          () => {
            const other = $getRoot().getLastChildOrThrow<ParagraphNode>();
            other.getFirstChildOrThrow<TextNode>().spliceText(0, 0, 'new ');
          },
          { discrete: true }
        );
        const from = writer.manager.doc.oplogVersion();
        const ops = await writer.write();
        expect(ops.length).toBeGreaterThan(0);
        expect(localWrites(ops)).toEqual([]);
        expect(
          physicalMarks(writer.manager).map((mark) => mark.metadata)
        ).toEqual([
          {
            id: 'historical-mark',
            peerId: '1',
            sharedPeerIds: ['2'],
            ...(legacyLocal !== undefined && { local: legacyLocal }),
          },
        ]);
        expect(
          writer.editor
            .getEditorState()
            .read(() => $getLocal($nodesOfType(CommentNode)[0]))
        ).toBe(runtimeLocal);

        receiver.receive(writer.manager.doc.export({ mode: 'update', from }));
        expect(
          receiver.editor
            .getEditorState()
            .read(() => $getLocal($nodesOfType(CommentNode)[0]))
        ).toBe(!runtimeLocal);
      }
    }
  );

  it('omits local on new marks and when a move recreates the mark in a different list', async () => {
    const doc = await openStored(bodyWithCommentMarks([false]));
    const [before] = physicalMarks(doc.manager);
    doc.editor.update(
      () => {
        const other = $getRoot().getLastChildOrThrow<ParagraphNode>();
        const existing = $nodesOfType(CommentNode)[0];
        $setLocal(existing, true);
        const added = $createCommentNode({ ids: ['new-mark'] });
        $setId(added, 'new-mark');
        $setPeerId(added, '2');
        $setLocal(added, true);
        other.append(existing, added.append($createTextNode('added')));
      },
      { discrete: true }
    );

    expect(localWrites(await doc.write())).toEqual([]);
    const after = physicalMarks(doc.manager);
    expect(after.map((mark) => mark.metadata)).toEqual([
      { id: 'historical-mark', peerId: '1', sharedPeerIds: ['2'] },
      { id: 'new-mark', peerId: '2' },
    ]);
    expect(after[0].container).not.toBe(before.container);
    expect(
      doc.editor
        .getEditorState()
        .read(() => $nodesOfType(CommentNode).map($getLocal))
    ).toEqual([true, true]);
  });

  it('keeps the same stored local field when a mark moves within its list', async () => {
    const doc = await openStored(bodyWithCommentMarks([false]));
    const before = physicalMarks(doc.manager);

    doc.editor.update(
      () => {
        const mark = $nodesOfType(CommentNode)[0];
        $setLocal(mark, true);
        $getRoot().getFirstChildOrThrow<ParagraphNode>().append(mark);
      },
      { discrete: true }
    );

    const ops = await doc.write();
    expect(ops.length).toBeGreaterThan(0);
    expect(localWrites(ops)).toEqual([]);
    expect(physicalMarks(doc.manager)).toEqual(before);
  });

  it('leaves legacy values on each physical sibling when durable IDs collide', async () => {
    const doc = await openStored(bodyWithCommentMarks([true, false]));
    const before = physicalMarks(doc.manager);
    expect(before.map((mark) => mark.metadata.local)).toEqual([true, false]);

    doc.editor.update(
      () => {
        for (const mark of $nodesOfType(CommentNode)) $setLocal(mark, true);
      },
      { discrete: true, tag: LOCAL_STATUS_TAG }
    );

    expect(localWrites(await doc.write({ compareAll: true }))).toEqual([]);
    expect(physicalMarks(doc.manager)).toEqual(expect.arrayContaining(before));
    expect(doc.version()).toBeUndefined();
    expect(doc.searchTexts()).toEqual([undefined, undefined]);

    expect(localWrites(await doc.write({ compareAll: true }))).toEqual([]);
    expect(physicalMarks(doc.manager)).toEqual(expect.arrayContaining(before));
    expect(doc.version()).toBeUndefined();
    expect(doc.searchTexts()).toEqual([undefined, undefined]);
  });
});

function searchTextWrites(ops: LoroOp[]) {
  return ops
    .filter((op) => op.content.key === 'searchText')
    .map((op) => op.content.value);
}

describe('loroSyncState derived fields', () => {
  it('writes nothing for an API body the editor only marked dirty', async () => {
    const doc = await openStored(apiBody(['First', 'Second', 'Third']));

    await doc.markTextDirty();

    expect(await doc.write()).toEqual([]);
    expect(await doc.write({ compareAll: true })).toEqual([]);
    expect(doc.searchTexts()).toEqual([undefined, undefined, undefined]);
    expect(doc.version()).toBeUndefined();
  });

  it('corrects a stored searchText that no longer matches its block', async () => {
    // Concurrent edits to one block merge its text but keep one searchText.
    const body = apiBody(['Merged text', 'Other']);
    const merged = body.root.children[0] as StoredBlock;
    merged.$ = { ...merged.$, searchText: 'Merged' };
    const doc = await openStored(body);

    await doc.markTextDirty();

    expect(searchTextWrites(await doc.write())).toEqual(['Merged text']);
    expect(doc.searchTexts()).toEqual(['Merged text', undefined]);
    expect(doc.version()).toBeUndefined();
  });

  it('writes searchText only for the block an edit changed', async () => {
    const doc = await openStored(apiBody(['First', 'Second', 'Third']));

    doc.editor.update(
      () => {
        const second = $getRoot().getChildAtIndex<ParagraphNode>(1)!;
        second.getFirstChildOrThrow<TextNode>().setTextContent('Second edit');
      },
      { discrete: true }
    );

    expect(searchTextWrites(await doc.write())).toEqual(['Second edit']);
    expect(doc.searchTexts()).toEqual([undefined, 'Second edit', undefined]);
    expect(doc.version()).toBe(MARKDOWN_VERSION_COUNTER);
  });

  it('writes searchText for a new or pasted block', async () => {
    const doc = await openStored(apiBody(['First', 'Third']));

    doc.editor.update(
      () => {
        $getRoot()
          .getFirstChildOrThrow()
          .insertAfter(
            $createParagraphNode().append($createTextNode('Pasted'))
          );
      },
      { discrete: true }
    );

    expect(searchTextWrites(await doc.write())).toEqual(['Pasted']);
    expect(doc.searchTexts()).toEqual([undefined, 'Pasted', undefined]);
  });

  it('keeps stored searchText current where the body already had it', async () => {
    const doc = await openStored(apiBody(['First', 'Second']));
    await doc.write({ compareAll: true });
    doc.editor.update(
      () => {
        const first = $getRoot().getFirstChildOrThrow<ParagraphNode>();
        first.getFirstChildOrThrow<TextNode>().setTextContent('First edit');
      },
      { discrete: true }
    );
    expect(searchTextWrites(await doc.write())).toEqual(['First edit']);

    doc.editor.update(
      () => {
        const second = $getRoot().getChildAtIndex<ParagraphNode>(1)!;
        second.getFirstChildOrThrow<TextNode>().setTextContent('Second edit');
      },
      { discrete: true }
    );

    expect(searchTextWrites(await doc.write())).toEqual(['Second edit']);
    expect(doc.searchTexts()).toEqual(['First edit', 'Second edit']);
  });
});

describe('canvas card viewport serialization', () => {
  const cameraFields = new Set<unknown>([
    'previewData',
    'view',
    'x',
    'y',
    'scale',
  ]);
  const canvas = {
    documentId: 'canvas-1',
    documentName: 'Canvas',
    blockName: 'canvas',
    blockParams: { canvas_x: '15', canvas_y: '25', canvas_scale: '100' },
    previewData: { view: { x: 30, y: 40, scale: 100 } },
  };

  it.each([
    [{}, undefined],
    [undefined, {}],
    [null, {}],
  ])(
    'keeps stored canvas preview %j when the editor has %j during a text edit',
    async (storedPreview, editorPreview) => {
      const editorBody = apiBody(
        ['Before'],
        [{ ...canvas, previewData: undefined }]
      );
      const storedBody = structuredClone(editorBody);
      if (storedPreview === undefined) {
        Reflect.deleteProperty(storedBody.root.children[1], 'previewData');
      } else {
        Object.assign(storedBody.root.children[1], {
          previewData: storedPreview,
        });
      }
      Object.assign(editorBody.root.children[1], {
        previewData: editorPreview,
      });
      const doc = await openStored(storedBody, editorBody);
      const card = doc.manager.doc.getByPath('root/children/1');
      if (!(card instanceof LoroMap)) throw new Error('Missing canvas card');
      expect(card.toJSON().previewData).toEqual(storedPreview);

      doc.editor.update(
        () => {
          const paragraph = $getRoot().getFirstChildOrThrow<ParagraphNode>();
          paragraph.getFirstChildOrThrow<TextNode>().setTextContent('After');
        },
        { discrete: true }
      );

      const ops = await doc.write();
      expect(ops.length).toBeGreaterThan(0);
      expect(ops.some((op) => cameraFields.has(op.content.key))).toBe(false);
      expect(card.toJSON().previewData).toEqual(storedPreview);
    }
  );

  it('writes non-viewport preview metadata on an existing canvas card', async () => {
    const body = apiBody(['Before'], [{ ...canvas, previewData: undefined }]);
    Object.assign(body.root.children[1], { previewData: {} });
    const doc = await openStored(body);
    const previewData = { poll: { optionCount: 3 } };
    doc.editor.update(
      () =>
        $getRoot()
          .getLastChildOrThrow<DocumentCardNode>()
          .setPreviewData(previewData),
      { discrete: true }
    );

    const ops = await doc.write();
    expect(
      ops.some(
        (op) => op.content.key === 'poll' || op.content.key === 'previewData'
      )
    ).toBe(true);
    const card = doc.manager.doc.getByPath('root/children/1');
    if (!(card instanceof LoroMap)) throw new Error('Missing canvas card');
    expect(card.toJSON().previewData).toEqual(previewData);
  });

  it.each([true, false])(
    'keeps a stored legacy viewport change or removal while publishing local text and card edits (has view: %s)',
    async (hasView) => {
      const body = apiBody(['Before'], [canvas]);
      const doc = await openStored(body);
      const oldPeer = structuredClone(body);
      const oldPeerView = hasView
        ? { view: { x: 55, y: 65, scale: 125 } }
        : undefined;
      Object.assign(oldPeer.root.children[1], { previewData: oldPeerView });
      await doc.writeFromOldPeer(oldPeer);

      doc.editor.update(
        () => {
          const paragraph = $getRoot().getFirstChildOrThrow<ParagraphNode>();
          paragraph.getFirstChildOrThrow<TextNode>().setTextContent('After');
          const card = $getRoot().getLastChildOrThrow<DocumentCardNode>();
          expect(card.getPreviewData()).toEqual(canvas.previewData);
          card.setPreviewBox(['100%', '500px']);
        },
        { discrete: true }
      );

      const ops = await doc.write();
      expect(ops.some((op) => cameraFields.has(op.content.key))).toBe(false);
      expect(doc.stored()?.root.children).toMatchObject([
        { children: [{ text: 'After' }] },
        { blockParams: canvas.blockParams, previewBox: ['100%', '500px'] },
      ]);
      const storedCard = doc.stored()?.root.children[1];
      if (hasView) {
        expect(storedCard).toMatchObject({ previewData: oldPeerView });
      } else {
        expect(storedCard).not.toHaveProperty('previewData.view');
      }
    }
  );

  it('writes new explicit seeds and poll metadata and can delete a canvas card', async () => {
    const poll = {
      documentId: 'form-1',
      documentName: 'Poll',
      blockName: 'form',
      previewData: { poll: { optionCount: 3 } },
    };
    const doc = await openStored(
      apiBody(
        ['Before'],
        [canvas, { ...poll, previewData: { poll: { optionCount: 2 } } }]
      )
    );
    doc.editor.update(
      () => {
        const root = $getRoot();
        const oldCard = root.getChildAtIndex<DocumentCardNode>(1);
        if (!oldCard) throw new Error('Missing existing canvas card');
        oldCard.remove();
        const existingPoll = root.getLastChildOrThrow<DocumentCardNode>();
        existingPoll.setPreviewData(poll.previewData);
        existingPoll.insertBefore(
          $createDocumentCardNode({ ...canvas, documentId: 'canvas-2' })
        );
      },
      { discrete: true }
    );
    await doc.write();
    expect(doc.stored()?.root.children).toMatchObject([
      { children: [{ text: 'Before' }] },
      { documentId: 'canvas-2', previewData: canvas.previewData },
      poll,
    ]);
  });

  it('leaves both stored legacy views alone when Loro updates the last physical card with a duplicate id', async () => {
    const body = apiBody(['Before'], [canvas]);
    const stored = structuredClone(body);
    const first = stored.root.children[1];
    const secondView = { view: { x: 3, y: 4, scale: 125 } };
    const second = Object.assign(structuredClone(first), {
      previewData: secondView,
    });
    stored.root.children.push(second);
    const doc = await openStored(stored, body);
    expect(doc.stored()?.root.children).toHaveLength(3);

    doc.editor.update(
      () => {
        const card = $getRoot().getLastChildOrThrow<DocumentCardNode>();
        card.setPreviewBox(['100%', '500px']);
      },
      { discrete: true }
    );

    const ops = await doc.write();
    expect(ops.some((op) => op.content.key === 'previewBox')).toBe(true);
    expect(ops.some((op) => cameraFields.has(op.content.key))).toBe(false);
    const children = doc.manager.doc.getByPath('root/children');
    if (!(children instanceof LoroMovableList))
      throw new Error('Missing stored list');
    expect(children.toJSON().slice(1)).toMatchObject([
      { previewData: canvas.previewData, previewBox: ['100%', '400px'] },
      { previewData: secondView, previewBox: ['100%', '500px'] },
    ]);
  });
});
