// @vitest-environment jsdom
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import { $updateAllNodeIds, nodeIdPlugin } from '@macro-inc/lexical-core';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { serializedEditorStateToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type NodeKey,
  ParagraphNode,
  type SerializedEditorState,
  TextNode,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

function newEditor() {
  const editor = createEditor({
    onError: (error) => {
      throw error;
    },
  });
  cleanups.push(
    nodeIdPlugin({ nodes: [ParagraphNode, TextNode], mappings: newMappings() })(
      editor
    ),
    documentMetadataPlugin({})(editor)
  );
  return editor;
}

/** A body as the API stores it: node ids, and no searchText or version. */
function apiBody(paragraphs: string[]): SerializedEditorState {
  const source = createEditor({
    onError: (error) => {
      throw error;
    },
  });
  source.update(
    () => {
      $getRoot().append(
        ...paragraphs.map((text) =>
          $createParagraphNode().append($createTextNode(text))
        )
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
async function openStored(body: SerializedEditorState) {
  const manager: LoroManager = new LoroManager(MARKDOWN_LORO_SCHEMA, {
    documentId: 'document',
  });
  const snapshot = await serializedEditorStateToLoroSnapshot(body);
  if (!snapshot) throw new Error('no snapshot');
  expect((await manager.initializeFromSnapshot(snapshot)).isOk()).toBe(true);

  const stored = () =>
    manager.state?.state as unknown as SerializedEditorState | undefined;
  const editor = newEditor();
  editor.setEditorState(editor.parseEditorState(stored()!));

  let changed = new Set<NodeKey>();
  cleanups.push(
    editor.registerUpdateListener(
      ({ editorState, dirtyElements, dirtyLeaves }) =>
        recordChangedBlocks(editorState, dirtyElements, dirtyLeaves, changed)
    )
  );

  return {
    editor,
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
