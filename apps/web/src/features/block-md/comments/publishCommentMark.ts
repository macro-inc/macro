import { $cursorToLexicalPoint } from '@core/component/LexicalMarkdown/collaboration/cursor';
import type { LexicalSelectionAwareness } from '@core/component/LexicalMarkdown/collaboration/LexicalAwareness';
import { $unwrapMarkNode, $wrapSelectionInMarkNode } from '@lexical/mark';
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import type { LiveSyncSource } from '@macro-inc/collaboration/collab/source';
import {
  $createCommentNode,
  $getCommentMarkText,
  $updateAllNodeIds,
  CommentNode,
  type NodeIdMappings,
  NodeReplacements,
  nodeIdPlugin,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { Telemetry } from '@macro-inc/observability';
import { $createRangeSelection, $nodesOfType, createEditor } from 'lexical';

type CommentMarkChange = {
  manager?: LoroManager;
  active?: () => boolean;
  source: LiveSyncSource;
  markId: string;
} & (
  | { action: 'add'; cursors: LexicalSelectionAwareness; text: string }
  | { action: 'remove' }
);

/** Publish from a separate peer: a refused mark must never enter the editor's WAL. */
export async function publishCommentMark(options: {
  manager: LoroManager;
  active?: () => boolean;
  source: LiveSyncSource;
  markId: string;
  cursors: LexicalSelectionAwareness;
  text: string;
}): Promise<boolean> {
  return changeCommentMark({ ...options, action: 'add' });
}

export function removePublishedCommentMark(options: {
  manager?: LoroManager;
  active?: () => boolean;
  source: LiveSyncSource;
  markId: string;
}) {
  return changeCommentMark({ ...options, action: 'remove' });
}

async function changeCommentMark(options: CommentMarkChange): Promise<boolean> {
  const { manager, source, markId } = options;
  const active = options.active ?? (() => true);
  const liveVersion =
    manager && active() ? manager.doc.oplogVersion() : undefined;
  const span = Telemetry.span('comment.mark.publish');
  span.setAttr('comment.action', options.action);
  span.setAttr('document.id', source.documentId);
  span.setAttr('comment.mark_id', markId);
  const staged: LoroManager = new LoroManager(MARKDOWN_LORO_SCHEMA, {
    documentId: source.documentId,
    ownsTelemetry: false,
  });
  const editor = createEditor({
    namespace: 'comment-publication',
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError: (error) => {
      throw error;
    },
  });
  const mapping: NodeIdMappings = {
    idToNodeKeyMap: new Map(),
    nodeKeyToIdMap: new Map(),
  };
  const cleanup = nodeIdPlugin({
    nodes: SupportedNodeTypes,
    idLength: 8,
    mappings: mapping,
  })(editor);
  const refuse = (reason: string) => {
    span.setAttr('comment.outcome', reason);
    Telemetry.warn('comment.mark.publication_failed', {
      'document.id': source.documentId,
      'comment.mark_id': markId,
      'comment.reason': reason,
    });
    return false;
  };
  try {
    const snapshot = await source.requestSnapshot();
    if (snapshot.isErr()) return refuse('snapshot_failed');
    const loaded = await staged.initializeFromSnapshot(snapshot.value);
    if (loaded.isErr() || !staged.state) return refuse('snapshot_invalid');
    if (manager && liveVersion) {
      const compared = staged.doc.oplogVersion().compare(liveVersion);
      if (compared === undefined || compared < 0)
        return refuse('local_changes_pending');
      if (compared > 0) {
        // A shallow snapshot cannot supply an existing peer's missing history.
        // Catch up before publishing, including retries of an accepted mark.
        span.setAttr('comment.catchup_required', true);
        const updates = await source.requestUpdatesSince(
          manager.doc.oplogVersion()
        );
        if (!active()) return refuse('cancelled');
        if (updates.isErr()) return refuse('catchup_failed');
        if (manager.importUpdate(updates.value).isErr())
          return refuse('catchup_merge_failed');
        const merged = manager.doc
          .oplogVersion()
          .compare(staged.doc.oplogVersion());
        if (merged === undefined || merged < 0)
          return refuse('catchup_incomplete');
      }
      // Draft cursors can refer to text containers replaced by a remote edit.
      // Keep the live peer's history so they resolve after snapshot compaction.
      const restored = await staged.reset(
        manager.doc.export({ mode: 'snapshot' })
      );
      if (restored.isErr() || !staged.state)
        return refuse('history_snapshot_invalid');
    }
    if (!active()) return refuse('cancelled');
    editor.setEditorState(
      editor.parseEditorState(JSON.stringify(staged.state.state))
    );
    let placed = false;
    editor.update(
      () => {
        $updateAllNodeIds(mapping);
        if (options.action === 'remove') {
          for (const node of $nodesOfType(CommentNode)) {
            if (!node.isAttached() || !node.getIDs().includes(markId)) continue;
            if (node.getIDs().length > 1) node.deleteID(markId);
            else $unwrapMarkNode(node);
          }
          placed = true;
          return;
        }
        // An earlier request may have landed even though its acknowledgement was lost.
        if ($getCommentMarkText(markId)) {
          placed = true;
          return;
        }
        const anchor = $cursorToLexicalPoint(
          options.cursors.anchor,
          staged,
          editor,
          mapping
        );
        const focus = $cursorToLexicalPoint(
          options.cursors.focus,
          staged,
          editor,
          mapping
        );
        if (!anchor || !focus) return;
        const selection = $createRangeSelection();
        selection.anchor.set(anchor.key, anchor.offset, anchor.type);
        selection.focus.set(focus.key, focus.offset, focus.type);
        if (
          selection.getTextContent() !== options.text ||
          selection.isCollapsed()
        )
          return;
        $wrapSelectionInMarkNode(
          selection,
          selection.isBackward(),
          markId,
          (ids) => $createCommentNode({ ids, isDraft: false })
        );
        placed = true;
      },
      { discrete: true }
    );
    if (!placed) {
      return refuse('selection_changed');
    }
    const version = staged.doc.oplogVersion();
    const synced = await staged.syncToLoro({
      ...editor.getEditorState().toJSON(),
    });
    if (synced.isErr()) return refuse('staging_failed');
    const update = staged.doc.export({ mode: 'update', from: version });
    if (!active()) return refuse('cancelled');
    const acked = await source.pushUpdate([update], { commentOnly: true });
    span.setAttr('comment.outcome', acked ? 'accepted' : 'not_acked');
    if (!acked) return refuse('not_acked');
    if (manager && active()) {
      if (manager.importUpdate(update).isErr())
        return refuse('update_merge_failed');
    }
    return true;
  } finally {
    cleanup();
    staged.dispose();
    span.end();
  }
}
