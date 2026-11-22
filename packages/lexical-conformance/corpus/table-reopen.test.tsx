import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
} from 'lexical';
import { LoroDoc, LoroMap } from 'loro-crdt';
import { okAsync } from 'neverthrow';
import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { CollabProvider } from '../../../apps/web/src/lib/core/component/LexicalMarkdown/collaboration/CollabProvider';
import { FLUSH_COLLABORATION_COMMAND } from '../../../apps/web/src/lib/core/component/LexicalMarkdown/collaboration/flush';
import {
  createLexicalWrapper,
  isWrapperWithIds,
} from '../../../apps/web/src/lib/core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { registerMarkdownEditing } from '../../../apps/web/src/lib/core/component/LexicalMarkdown/editing/registerMarkdownEditing';
import { MARKDOWN_VERSION_COUNTER } from '../../../apps/web/src/lib/core/component/LexicalMarkdown/version';
import { ENABLE_MARKDOWN_SEARCH_TEXT } from '../../../apps/web/src/lib/core/constant/featureFlags';
import { LoroManager } from '../../collaboration/src/collab/manager';
import { createNoopLiveSyncSource } from '../../collaboration/src/collab/source';
import { MARKDOWN_LORO_SCHEMA } from '../../lexical-core/markdown-loro-schema';

// These isolate account lookup and import-time service sockets, not editor,
// metadata, mirror, history, sync-engine or WAL behavior.
vi.mock('../../../apps/web/src/lib/core/internal/BlockLoader', () => ({}));
vi.mock('../../../apps/web/src/lib/core/context/user', () => ({
  useUserId: () => () => 'table-reopen-fixture',
}));
vi.mock(
  '../../../apps/web/src/lib/service-clients/service-storage/websocket',
  () => ({
    storageWS: {
      send() {},
      addEventListener() {},
      removeEventListener() {},
      reconnectIfDisconnected() {},
    },
    createWebSocketJob: vi.fn(),
  })
);
vi.mock(
  '../../../apps/web/src/lib/service-clients/service-connection/websocket',
  () => ({
    ws: { send() {}, addEventListener() {}, removeEventListener() {} },
    state: () => 'closed',
    createConnectionBlockWebsocketEffect: vi.fn(),
    createConnectionWebsocketEffect: vi.fn(),
    parseWebsocketPayload: () => undefined,
  })
);

const repository = (() => {
  const root = process.env.SOURCE_REPOSITORY_ROOT;
  if (!root) throw new Error('Source repository root is required');
  return root;
})();
const receivedPath = join(
  repository,
  'crates/client/document_session/tests/testdata/table-keyless-reopen-received.loro'
);

function prepareReceived(
  server: LoroDoc,
  name: string,
  tagsNull: boolean,
  version: number
) {
  server.setPeerId(9000n);
  server.setRecordTimestamp(false);
  server.import(readFileSync(receivedPath));
  const expectedChildren = server.toJSON().root.children;
  const missingSearch = name === 'missing-search';
  if (missingSearch) {
    const state = server.getByPath('root/children/0/$');
    if (!(state instanceof LoroMap))
      throw new Error('paragraph state required');
    state.delete('searchText');
  }
  if (tagsNull || version !== 10 || missingSearch) {
    const rootState = server.getMap('root').get('$');
    if (!(rootState instanceof LoroMap))
      throw new Error('root state map required');
    const metadata = rootState.get('documentMetadata');
    if (!(metadata instanceof LoroMap))
      throw new Error('metadata map required');
    if (tagsNull) metadata.set('environmentTags', null);
    if (version !== 10) metadata.set('version', version);
    server.commit();
  }
  const snapshot =
    tagsNull || version !== 10 || missingSearch
      ? server.export({ mode: 'snapshot' })
      : readFileSync(receivedPath);
  return { snapshot, expectedChildren };
}

// Persist failed controls too; verification mode compares a fresh run without rewriting.
function recordResult(
  name: string,
  result: object,
  snapshot: Uint8Array,
  commits: Uint8Array[]
) {
  const captureRoot = process.env.SOURCE_TABLE_REOPEN_OUT;
  const out = captureRoot && join(captureRoot, name);
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/received.loro`, snapshot);
    writeFileSync(`${out}/source.json`, `${JSON.stringify(result, null, 2)}\n`);
    for (const [index, bytes] of commits.entries()) {
      writeFileSync(`${out}/update-${index}.loro`, bytes);
    }
  }
  if (!out) {
    const profile = ENABLE_MARKDOWN_SEARCH_TEXT ? 'search-on' : 'search-off';
    const recorded = JSON.parse(
      readFileSync(
        join(
          repository,
          'packages/lexical-conformance/fixtures/table-reopen-v11',
          profile,
          name,
          'source.json'
        ),
        'utf8'
      )
    );
    expect(result).toEqual(recorded);
  }
}

it.each([
  { name: 'edit', editable: true, tagsNull: false, version: 10 },
  { name: 'tags-null', editable: true, tagsNull: true, version: 10 },
  { name: 'read', editable: false, tagsNull: false, version: 10 },
  { name: 'comment', editable: false, tagsNull: false, version: 10 },
  { name: 'current', editable: true, tagsNull: false, version: 11 },
  { name: 'current-null', editable: true, tagsNull: true, version: 11 },
  { name: 'missing-search', editable: true, tagsNull: false, version: 10 },
])(
  'records the v11 Source keyless-table reopen: $name',
  async ({ name, editable, tagsNull, version }) => {
    const documentId = `source-table-reopen-v11-${name}`;
    const server = new LoroDoc();
    const { snapshot, expectedChildren } = prepareReceived(
      server,
      name,
      tagsNull,
      version
    );
    const received = server.toJSON();
    expect(received.root.$.documentMetadata).toEqual(
      tagsNull ? { version, environmentTags: null } : { version }
    );
    const table = received.root.children.find(
      (node: { type: string }) => node.type === 'table'
    );
    expect(table).toBeDefined();
    expect(table).not.toHaveProperty('frozenRowCount');
    expect(table).not.toHaveProperty('frozenColumnCount');
    expect(table).not.toHaveProperty('rowStriping');
    const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, {
      documentId,
    });
    manager.doc.setPeerId(9001n);
    manager.doc.setRecordTimestamp(false);
    const initialized = await manager.initializeFromSnapshot(snapshot);
    expect(initialized.isOk()).toBe(true);

    const undoFactory = vi.spyOn(manager, 'createUndoManager');
    const events: { by: string; origin: string | null }[] = [];
    const unsubscribeEvents = manager.doc.subscribe((event) => {
      events.push({ by: event.by, origin: event.origin ?? null });
    });
    const commits: Uint8Array[] = [];
    const unsubscribe = manager.doc.subscribeLocalUpdates((bytes) => {
      commits.push(bytes.slice());
    });
    const live = {
      ...createNoopLiveSyncSource(documentId),
      pushUpdate: async (updates: Uint8Array[]) => {
        for (const update of updates) server.import(update);
        return true;
      },
      requestUpdatesSince: (version: ReturnType<LoroDoc['version']>) =>
        okAsync(server.export({ mode: 'update', from: version })),
      requestSnapshot: () => okAsync(server.export({ mode: 'snapshot' })),
    };
    const history = { canUndo: false, canRedo: false };
    const ready = Promise.withResolvers<void>();
    let wrapper!: ReturnType<typeof createLexicalWrapper>;
    const dispose = createRoot((dispose) => {
      wrapper = createLexicalWrapper({
        type: 'markdown-sync',
        namespace: 'source-table-reopen-v11',
        isInteractable: () => editable,
        withIds: true,
      });
      if (!isWrapperWithIds(wrapper)) throw new Error('expected node ids');
      const element = document.createElement('div');
      element.contentEditable = 'true';
      document.body.append(element);
      wrapper.editor.setRootElement(element);
      wrapper.plugins
        .richText()
        .list()
        .markdownShortcuts()
        .delete()
        .history(400, manager);
      registerMarkdownEditing({
        lexicalWrapper: wrapper,
        isContentEditable: () => editable,
        peerIdValidator: () => true,
        source: { id: documentId, trackMentions: false },
        onVersionError: (error) =>
          ready.reject(new Error(`version error ${error}`)),
      });
      wrapper.editor.registerCommand(
        CAN_UNDO_COMMAND,
        (value) => {
          history.canUndo = value;
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      );
      wrapper.editor.registerCommand(
        CAN_REDO_COMMAND,
        (value) => {
          history.canRedo = value;
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      );
      CollabProvider({
        editor: wrapper.editor,
        pluginManager: wrapper.plugins,
        editorContainerRef: element,
        highlightLayerRef: document.createElement('div'),
        mappings: wrapper.mapping,
        editorFocus: () => false,
        setEditorReady: (value) => {
          if (value === true) ready.resolve();
          return true;
        },
        setEditorError: (error) => {
          ready.reject(new Error(`editor error ${error}`));
          return null;
        },
        loroManager: manager,
        syncSource: () => live,
        sourceReady: () => true,
        canEdit: () => editable,
        editorError: () => null,
      });
      return dispose;
    });
    const replay = new LoroDoc();
    try {
      await ready.promise;
      const flushed = Promise.withResolvers<boolean>();
      wrapper.editor.dispatchCommand(
        FLUSH_COLLABORATION_COMMAND,
        flushed.resolve
      );
      expect(await flushed.promise).toBe(true);
      replay.import(snapshot);
      const updates = commits.map((bytes) => {
        const from = replay.oplogVersion();
        replay.import(bytes);
        return replay.exportJsonUpdates(from, replay.oplogVersion());
      });
      expect(undoFactory).toHaveBeenCalledTimes(1);
      const capturedUndo = undoFactory.mock.results[0];
      if (capturedUndo?.type !== 'return')
        throw new Error('real undo manager required');
      const undo = capturedUndo.value;
      const result = {
        sourceVersion: MARKDOWN_VERSION_COUNTER,
        receivedSHA256: createHash('sha256').update(snapshot).digest('hex'),
        received,
        updates,
        events,
        stored: manager.doc.toJSON(),
        history,
        // Command notifications can lag the actual manager until another editor update.
        undoManager: {
          canUndo: undo.canUndo(),
          canRedo: undo.canRedo(),
        },
        searchTextEnabled: ENABLE_MARKDOWN_SEARCH_TEXT,
      };
      recordResult(name, result, snapshot, commits);
      console.log(
        JSON.stringify({
          name,
          updates: result.updates,
          history,
          undoManager: result.undoManager,
          searchTextEnabled: ENABLE_MARKDOWN_SEARCH_TEXT,
        })
      );
      expect(MARKDOWN_VERSION_COUNTER).toBe(11);
      expect(result.stored.root.$.documentMetadata).toEqual(
        editable ? { version: 11, environmentTags: null } : { version: 10 }
      );
      expect(result.stored.root.children).toEqual(
        ENABLE_MARKDOWN_SEARCH_TEXT ? expectedChildren : received.root.children
      );
      expect(ENABLE_MARKDOWN_SEARCH_TEXT).toBe(
        process.env.SOURCE_TABLE_REOPEN_SEARCH_TEXT === 'true'
      );
      expect(result.undoManager).toEqual({
        canUndo: editable && !(version === 11 && tagsNull),
        canRedo: false,
      });
      if (!editable) expect(commits).toEqual([]);
    } finally {
      replay.free();
      unsubscribe();
      unsubscribeEvents();
      dispose();
      wrapper.cleanup();
      undoFactory.mockRestore();
      manager.dispose();
      server.free();
      document.body.replaceChildren();
    }
  }
);
