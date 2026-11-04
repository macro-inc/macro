import {
  $convertLexicalSelectionToCursors,
  $cursorToLexicalPoint,
} from '@core/component/LexicalMarkdown/collaboration/cursor';
import { flushCollaboration } from '@core/component/LexicalMarkdown/collaboration/flush';
import type { LexicalSelectionAwareness } from '@core/component/LexicalMarkdown/collaboration/LexicalAwareness';
import { LocationHighlight } from '@core/component/LexicalMarkdown/component/core/Highlights';
import type { EphemeralLocation } from '@core/component/LexicalMarkdown/plugins/location/locationPlugin';
import { fireAndForget } from '@core/util/fireAndForget';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import type { LiveSyncSource } from '@macro-inc/collaboration/collab/source';
import { BrowserWALStore } from '@macro-inc/collaboration/collab/wal';
import {
  $getCommentMarkText,
  type NodeIdMappings,
} from '@macro-inc/lexical-core';
import { Telemetry } from '@macro-inc/observability';
import {
  $createRangeSelection,
  $isElementNode,
  $isTextNode,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import { createCommentMarkCleanup } from './commentMarkCleanup';
import {
  publishCommentMark,
  removePublishedCommentMark,
} from './publishCommentMark';

export type DraftPublication = {
  text: () => string | undefined;
  publish: () => Promise<boolean>;
  post: <T>(send: () => Promise<T | null>) => Promise<T | null>;
};

type LocalDraft = {
  id: string;
  cursors: LexicalSelectionAwareness;
  pending?: Promise<boolean>;
  source?: LiveSyncSource;
  cleanup?: Promise<void>;
  cleanupQueue?: ReturnType<typeof createCommentMarkCleanup>;
  posting: boolean;
  postUncertain: boolean;
  committed: boolean;
};

/** A draft is a pair of CRDT cursors, never split text nodes in the shared tree. */
export function createLocalCommentDraft(options: {
  editor: LexicalEditor;
  manager: LoroManager;
  mapping: NodeIdMappings;
  source: () => LiveSyncSource | undefined;
  interactable: () => boolean;
  userId: () => string | undefined;
  hasPostedComment: (markId: string) => Promise<boolean>;
  add: (id: string, anchor: HTMLElement, publication: DraftPublication) => void;
  remove: (id: string) => void;
}) {
  const { editor, manager, mapping } = options;
  const [draft, setDraft] = createSignal<LocalDraft>();
  const [location, setLocation] = createSignal<EphemeralLocation>();
  const [mount, setMount] = createSignal<HTMLElement>();
  const anchorElement = document.createElement('span');
  anchorElement.dataset.commentDraftAnchor = '';
  anchorElement.style.cssText = 'position:absolute;pointer-events:none';
  let disposed = false;
  let publishingCount = 0;
  const lockEditor = async (operation: () => Promise<boolean>) => {
    publishingCount += 1;
    editor.setEditable(false);
    try {
      return await operation();
    } finally {
      publishingCount -= 1;
      if (!disposed && publishingCount === 0)
        editor.setEditable(options.interactable());
    }
  };
  const cleanupQueue = createMemo(() => {
    const userId = options.userId();
    if (!userId) return;
    return createCommentMarkCleanup(
      new BrowserWALStore<string>(
        'macro-comment-mark-cleanup',
        JSON.stringify([userId, manager.documentId])
      ),
      async (markId) => {
        const active = () => !disposed && options.userId() === userId;
        const source = options.source();
        if (!active() || !source) return false;
        // A persisted message always owns its mark, even after a lost response.
        if (await options.hasPostedComment(markId)) return true;
        return lockEditor(async () => {
          if (!active() || !(await flushCollaboration(editor))) return false;
          if (!active()) return false;
          return removePublishedCommentMark({
            manager,
            source,
            markId,
            active,
          });
        });
      }
    );
  });
  createEffect(() => {
    const queue = cleanupQueue();
    const source = options.source();
    if (!queue || !source) return;
    const replay = () => fireAndForget(queue.flush(), 'comment-draft-cleanup');
    let initialized = false;
    onCleanup(
      editor.registerUpdateListener(() => {
        if (initialized || !manager.initialized) return;
        initialized = true;
        replay();
      })
    );
    onCleanup(
      source.listen((event) => {
        if (event.type === 'connect' || event.type === 'reconnect') replay();
      })
    );
    window.addEventListener('online', replay);
    onCleanup(() => window.removeEventListener('online', replay));
    replay();
  });
  const cleanupPublished = (record: LocalDraft) => {
    if (
      !record.source ||
      record.committed ||
      record.posting ||
      record.postUncertain
    )
      return Promise.resolve();
    record.cleanup ??= record.cleanupQueue?.enqueue(record.id);
    return record.cleanup ?? Promise.resolve();
  };

  const $selection = () => {
    const current = draft();
    if (!current) return null;
    const anchor = $cursorToLexicalPoint(
      current.cursors.anchor,
      manager,
      editor,
      mapping
    );
    const focus = $cursorToLexicalPoint(
      current.cursors.focus,
      manager,
      editor,
      mapping
    );
    if (!anchor || !focus) return null;
    for (const point of [anchor, focus]) {
      const node = point.getNode();
      const size = $isTextNode(node)
        ? node.getTextContentSize()
        : $isElementNode(node)
          ? node.getChildrenSize()
          : 0;
      if (point.offset > size) return null;
    }
    const selection = $createRangeSelection();
    selection.anchor.set(anchor.key, anchor.offset, anchor.type);
    selection.focus.set(focus.key, focus.offset, focus.type);
    return selection;
  };
  const refresh = () =>
    editor.getEditorState().read(() => {
      const selection = $selection();
      if (!selection || selection.isCollapsed()) {
        setLocation();
        return;
      }
      setLocation({
        type: 'ephemeral',
        anchor: { key: selection.anchor.key, offset: selection.anchor.offset },
        focus: { key: selection.focus.key, offset: selection.focus.offset },
      });
    });
  const text = () =>
    editor.read(() => {
      const current = draft();
      if (!current) return undefined;
      return $getCommentMarkText(current.id) || $selection()?.getTextContent();
    });
  const clear = (committed: boolean) => {
    const current = draft();
    if (current && committed) current.committed = true;
    setDraft();
    setLocation();
    anchorElement.remove();
    if (current) {
      options.remove(current.id);
      if (!current.pending && !committed)
        fireAndForget(cleanupPublished(current), 'comment-draft-cleanup');
    }
  };
  const discard = () => clear(false);
  onCleanup(
    editor.registerRootListener((root) => {
      setMount(root?.parentElement ?? undefined);
    })
  );
  onCleanup(editor.registerUpdateListener(refresh));
  onCleanup(
    editor.registerEditableListener((editable) => {
      if (editable && publishingCount > 0) editor.setEditable(false);
    })
  );
  onCleanup(() => {
    disposed = true;
    discard();
  });
  return {
    current: () => draft()?.id,
    create: (id: string, selection: RangeSelection) => {
      const userId = options.userId();
      if (!userId || !manager.initialized || !mount()) return false;
      const cursors = $convertLexicalSelectionToCursors(
        manager,
        mapping,
        selection
      );
      if (!cursors) return false;
      const record: LocalDraft = {
        id,
        cursors,
        posting: false,
        postUncertain: false,
        committed: false,
        cleanupQueue: cleanupQueue(),
      };
      setDraft(record);
      const active = () =>
        !disposed && draft() === record && options.userId() === userId;
      mount()!.append(anchorElement);
      options.add(id, anchorElement, {
        text,
        publish: () => {
          if (!active()) return Promise.resolve(false);
          if (record.pending) return record.pending;
          const source = options.source();
          const selectedText = text();
          if (!source || !selectedText || draft()?.id !== id)
            return Promise.resolve(false);
          record.source = source;
          const publish = async () => {
            try {
              const accepted = await lockEditor(async () => {
                if (!(await flushCollaboration(editor)) || !active())
                  return false;
                return publishCommentMark({
                  manager,
                  source,
                  markId: id,
                  cursors,
                  text: selectedText,
                  active,
                });
              });
              if (!active()) {
                await cleanupPublished(record);
                return false;
              }
              return accepted;
            } finally {
              record.pending = undefined;
            }
          };
          record.pending = publish();
          return record.pending;
        },
        post: async (send) => {
          if (!active()) return null;
          record.posting = true;
          let settled = false;
          try {
            const result = await send();
            settled = true;
            if (result) record.committed = true;
            return result;
          } finally {
            record.posting = false;
            if (!settled) record.postUncertain = true;
            if (record.postUncertain)
              Telemetry.warn('comment.message.outcome_unknown', {
                'document.id': manager.documentId,
                'comment.mark_id': record.id,
              });
            if (disposed || draft() !== record) await cleanupPublished(record);
          }
        },
      });
      // The create command has not committed its selection yet.
      setLocation({
        type: 'ephemeral',
        anchor: { key: selection.anchor.key, offset: selection.anchor.offset },
        focus: { key: selection.focus.key, offset: selection.focus.offset },
      });
      return true;
    },
    discard,
    commit: () => clear(true),
    Highlight: () => (
      <Show when={mount()}>
        {(element) => (
          <LocationHighlight
            editor={editor}
            location={location()}
            mountRef={element()}
            class="bg-comment-bg"
            captureBoundingDomRect={(rect) => {
              if (!location()) return;
              const parent = element().getBoundingClientRect();
              Object.assign(anchorElement.style, {
                left: `${rect.left - parent.left}px`,
                top: `${rect.top - parent.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
              });
            }}
          />
        )}
      </Show>
    ),
  };
}
