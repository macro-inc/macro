import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { CommentSelection } from '@macro-inc/lexical-wasm-view/view/comment-selection';
import { SessionPort } from '@macro-inc/lexical-wasm-view/view/session-port';
import type {
  NodeKey,
  ViewNode,
} from '@macro-inc/lexical-wasm-view/view/types';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createSignal } from 'solid-js';
import type {
  NativeCommentAnchor,
  NativeSelectionBookmark,
} from '../nativeMarkdownPorts';

/** A selection capture that also carries the durable cursors publication needs. */
export interface NativeCommentBookmark extends NativeSelectionBookmark {
  readonly cursors: CommentSelection;
}

/** Comment capabilities of the native body, independent of any Lexical editor. */
export interface NativeComments {
  /** Every rendered comment mark, keyed by mark id in document order. */
  readonly anchors: Accessor<readonly NativeCommentAnchor[]>;
  /** Mark ids at the caret, following Source `$getMarkIdsAtCaret`. */
  readonly caretMarkIds: Accessor<readonly string[]>;
  captureSelection(): NativeCommentBookmark | null;
  /** True only when the session accepted the mark. */
  publish(markId: string, bookmark: NativeCommentBookmark): Promise<boolean>;
  /** True only when the session accepted the removal. */
  remove(markId: string): Promise<boolean>;
  /** Source MARK_SELECTED_COMMENT_COMMAND: toggle `selected` on mark elements. */
  select(markIds: readonly string[]): void;
  dispose(): void;
}

const isMark = (node: ViewNode): boolean =>
  node.type === 'mark' || node.type === 'comment-mark';

function markIds(node: ViewNode): string[] {
  const ids = node.props().ids;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === 'string')
    : [];
}

function sessionPort(view: EditorView): SessionPort {
  if (!(view.port instanceof SessionPort))
    throw new Error('Native comments require the session port');
  return view.port;
}

export function createNativeComments(view: EditorView): NativeComments {
  const port = sessionPort(view);
  const [anchors, setAnchors] = createSignal<readonly NativeCommentAnchor[]>(
    []
  );
  const [caretMarkIds, setCaretMarkIds] = createSignal<readonly string[]>([]);
  // Comment-mark keys and their ids; maintained from sparse commit mutations.
  const marks = new Map<NodeKey, readonly string[]>();
  let selected: readonly string[] = [];
  let disposed = false;

  const node = (key: NodeKey | null | undefined) =>
    key === null || key === undefined ? null : view.mirror.node(key);

  // Source $getMarkIDs: a text end looks forward to a following mark, then up.
  const getMarkIds = (key: NodeKey, offset: number): string[] | null => {
    const text = node(key);
    if (!text) return null;
    if (text.kind === 'text' && offset === text.text.length) {
      const parent = node(text.parent);
      const index = parent?.children.indexOf(key) ?? -1;
      const next =
        parent && index >= 0 ? node(parent.children[index + 1]) : null;
      if (next && isMark(next)) return markIds(next);
    }
    for (
      let current = node(text.parent);
      current;
      current = node(current.parent)
    )
      if (isMark(current)) return markIds(current);
    return null;
  };
  const readCaretMarkIds = (): string[] => {
    const { selection } = view.selection();
    if (selection.kind !== 'range') return [];
    const { key, offset } = selection.anchor;
    const anchor = node(key);
    if (!anchor) return [];
    if (anchor.kind === 'text') {
      const ids = getMarkIds(key, offset);
      if (ids) return ids;
      if (offset !== 0) return [];
      const parent = node(anchor.parent);
      const index = parent?.children.indexOf(key) ?? -1;
      const previous =
        parent && index > 0 ? node(parent.children[index - 1]) : null;
      if (previous?.kind === 'text')
        return getMarkIds(previous.key, previous.text.length) ?? [];
      if (previous?.type === 'comment-mark') return markIds(previous);
      return [];
    }
    return anchor.type === 'comment-mark' ? markIds(anchor) : [];
  };

  const applySelected = (ids: readonly string[]) => {
    for (const [key, keyIds] of marks) {
      const element = view.getElementByKey(key);
      if (!element) continue;
      element.classList.toggle(
        'selected',
        keyIds.some((id) => ids.includes(id))
      );
    }
  };
  const publishAnchors = () => {
    const byId = new Map<string, HTMLElement[]>();
    for (const [key, ids] of marks) {
      const element = view.getElementByKey(key);
      if (!element) continue;
      for (const id of ids) {
        const list = byId.get(id) ?? [];
        list.push(element);
        byId.set(id, list);
      }
    }
    setAnchors([...byId].map(([markId, elements]) => ({ markId, elements })));
  };
  const index = (key: NodeKey) => {
    const current = node(key);
    if (current?.type === 'comment-mark') marks.set(key, markIds(current));
    else marks.delete(key);
  };
  const rebuild = () => {
    marks.clear();
    for (const current of view.mirror.values())
      if (current.type === 'comment-mark')
        marks.set(current.key, markIds(current));
  };

  rebuild();
  publishAnchors();
  setCaretMarkIds(readCaretMarkIds());
  const release = view.onCommit((commit) => {
    if (disposed) return;
    let changed = commit.fullReconcile;
    if (commit.fullReconcile) rebuild();
    else
      for (const key of new Set([
        ...commit.mutations.keys(),
        ...commit.properties,
      ]))
        if (marks.has(key) || node(key)?.type === 'comment-mark') {
          index(key);
          changed = true;
        }
    if (changed) {
      publishAnchors();
      applySelected(selected);
    }
    setCaretMarkIds(readCaretMarkIds());
  });

  const reply = async (
    markId: string,
    action: Parameters<SessionPort['comment']>[1]
  ): Promise<boolean> => {
    const span = Telemetry.span('comment.mark.publish');
    span.setAttr('comment.action', action.kind);
    span.setAttr('comment.mark_id', markId);
    try {
      const result = await port.comment(markId, action);
      span.setAttr('comment.reply', result.kind);
      if (result.kind === 'refused')
        span.setAttr('comment.refusal', result.reason);
      return result.kind === 'accepted';
    } finally {
      span.end();
    }
  };

  return {
    anchors,
    caretMarkIds,
    captureSelection() {
      if (disposed || view.mirror.keyGeneration === null) return null;
      const info = view.selection();
      if (info.selection.kind !== 'range') return null;
      const cursors = port.commentSelection();
      if (!cursors || cursors.text.trim() === '') return null;
      return {
        generation: view.mirror.keyGeneration,
        revision: view.documentRevision,
        selection: info.selection,
        text: cursors.text,
        cursors,
      };
    },
    publish(markId, bookmark) {
      if (disposed || bookmark.generation !== view.mirror.keyGeneration)
        return Promise.resolve(false);
      return reply(markId, { kind: 'add', ...bookmark.cursors });
    },
    remove(markId) {
      if (disposed) return Promise.resolve(false);
      return reply(markId, { kind: 'remove' });
    },
    select(ids) {
      selected = ids;
      applySelected(ids);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      release();
    },
  };
}
