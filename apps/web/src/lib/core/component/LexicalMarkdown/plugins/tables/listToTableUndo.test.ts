import { FROM_LORO_TAG } from '@core/component/LexicalMarkdown/collaboration/CollabProvider';
import { $reconcileLexicalState } from '@core/component/LexicalMarkdown/collaboration/reconcile';
import { registerLoroHistory } from '@core/component/LexicalMarkdown/collaboration/undo';
import { loroSyncState } from '@core/component/LexicalMarkdown/utils';
import { $isListNode, registerList } from '@lexical/list';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { registerRichText } from '@lexical/rich-text';
import { $isTableNode } from '@lexical/table';
import { SyncDirection } from '@loro-mirror/core';
import {
  createLoroManager,
  type LoroManager,
} from '@macro-inc/collaboration/collab/manager';
import {
  $updateAllNodeIds,
  ALL_TRANSFORMERS,
  COLLABORATION_TAG,
  type NodeIdMappings,
  nodeIdPlugin,
} from '@macro-inc/lexical-core';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import {
  NodeReplacements,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core/node-list';
import {
  $getRoot,
  CLEAR_HISTORY_COMMAND,
  createEditor,
  type SerializedEditorState,
  UNDO_COMMAND,
} from 'lexical';
import { LoroDoc } from 'loro-crdt';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { trailingParagraphPlugin } from '../trailing-paragraph/trailingParagraphPlugin';
import {
  LIST_TO_TABLE_COMMAND,
  registerListToTableCommand,
} from './listToTable';
import { tablePlugin } from './tablePlugin';

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

describe('list to table conversion in a collaborative document', () => {
  it('undoes back to the nested list, with the ids the shared document has', async () => {
    const editor = createEditor({
      namespace: 'list-to-table-undo',
      nodes: [...SupportedNodeTypes, ...NodeReplacements],
      onError: (error) => {
        throw error;
      },
    });
    const mappings: NodeIdMappings = {
      idToNodeKeyMap: new Map(),
      nodeKeyToIdMap: new Map(),
    };
    editor.setRootElement(document.createElement('div'));
    registerRichText(editor);
    registerList(editor);
    tablePlugin({
      hasCellMerge: true,
      hasCellBackgroundColor: true,
      hasTabHandler: true,
    })(editor);
    registerListToTableCommand(editor);
    trailingParagraphPlugin()(editor);
    nodeIdPlugin({ nodes: SupportedNodeTypes, mappings })(editor);

    let manager!: LoroManager<typeof MARKDOWN_LORO_SCHEMA>;
    createRoot(() => {
      manager = createLoroManager(MARKDOWN_LORO_SCHEMA, { documentId: 'doc' });
    });
    await manager.initializeFromSnapshot(
      new LoroDoc().export({ mode: 'snapshot' })
    );

    // Wired as CollabProvider wires them: local updates sync to Loro, and
    // Loro changes (here, the undo) are reconciled onto the editor by node id.
    const syncs: Promise<unknown>[] = [];
    editor.registerUpdateListener(({ editorState, tags, mutatedNodes }) => {
      if (tags.has(FROM_LORO_TAG) || !mutatedNodes?.size) return;
      syncs.push(manager.syncToLoro(loroSyncState(editorState) as never));
    });
    manager.onStateChange((update) => {
      if (update.metadata.direction === SyncDirection.TO_LORO) return;
      editor.update(
        () => {
          $reconcileLexicalState(
            editor.getEditorState().toJSON(),
            update.state as unknown as SerializedEditorState,
            mappings,
            () => manager.peerIdStr
          );
        },
        { discrete: true, tag: [FROM_LORO_TAG, COLLABORATION_TAG] }
      );
      queueMicrotask(() => editor.update(() => $updateAllNodeIds(mappings)));
    });
    registerLoroHistory(editor, manager, 300);

    editor.update(
      () => {
        $convertFromMarkdownString(
          [
            'intro',
            '',
            '- column 1',
            '  - a1',
            '    - deeper',
            '  - a2',
            '- column 2',
            '  - b1',
            '',
            'outro',
          ].join('\n'),
          ALL_TRANSFORMERS
        );
        $updateAllNodeIds(mappings);
      },
      { discrete: true }
    );
    await Promise.all(syncs);
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    const before = editor.getEditorState().toJSON();

    const listKey = editor.read(() => {
      const list = $getRoot().getChildAtIndex(1);
      if (!$isListNode(list)) throw new Error('expected the list');
      return list.getKey();
    });
    let converted = false;
    editor.update(
      () => {
        converted = editor.dispatchCommand(LIST_TO_TABLE_COMMAND, listKey);
      },
      { discrete: true }
    );
    expect(converted).toBe(true);
    await Promise.all(syncs);
    expect(editor.read(() => $isTableNode($getRoot().getChildAtIndex(1)))).toBe(
      true
    );

    editor.dispatchCommand(UNDO_COMMAND, undefined);
    await Promise.all(syncs);

    expect(editor.getEditorState().toJSON()).toEqual(before);
  });
});
