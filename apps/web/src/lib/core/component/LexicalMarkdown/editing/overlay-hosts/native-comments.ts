import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { CommentSelection } from '@macro-inc/lexical-wasm-view/view/comment-selection';
import { SessionPort } from '@macro-inc/lexical-wasm-view/view/session-port';
import type {
  NodeKey,
  Point,
  ViewNode,
  ViewSelection,
} from '@macro-inc/lexical-wasm-view/view/types';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  NativeCommentAnchor,
  NativeSelectionBookmark,
} from '../nativeMarkdownPorts';

/** A selection capture that also carries the durable cursors publication needs. */
export interface NativeCommentBookmark extends NativeSelectionBookmark {
  readonly cursors: CommentSelection;
}

/** One comment-mark node whose ids changed in a commit; absent ids mean no node. */
export interface NativeCommentMarkChange {
  readonly key: NodeKey;
  readonly before: readonly string[] | undefined;
  readonly after: readonly string[] | undefined;
  /** The mounted element for `after`, when it exists. */
  readonly element: HTMLElement | null;
  readonly isDraft: boolean;
}
export interface NativeCommentCommit {
  readonly changes: readonly NativeCommentMarkChange[];
  readonly selectionChanged: boolean;
  /** Mark ids still present anywhere after this commit. */
  readonly remainingIds: ReadonlySet<string>;
}

/** Comment capabilities of the native body, independent of any Lexical editor. */
export interface NativeComments {
  /** The native body view these marks render in. */
  readonly view: EditorView;
  /** The editable body root whose clicks reselect caret marks. */
  readonly root: HTMLElement;
  /** Mark ids on the comment-mark node with this key, if it exists. */
  markIds(key: NodeKey): readonly string[] | undefined;
  /** Every current comment-mark node as a change from nothing. */
  snapshot(): readonly NativeCommentMarkChange[];
  /** Called after each commit, once the indexes reflect it. */
  subscribe(listener: (commit: NativeCommentCommit) => void): () => void;
  /** Every rendered comment mark, keyed by mark id in document order. */
  readonly anchors: Accessor<readonly NativeCommentAnchor[]>;
  /** Source `$selectMarksAtCaret`'s outcome for the published selection: null
   *  for no selection (leave the selected marks), [] to clear them (no mark,
   *  or not a range), otherwise the caret's mark ids. */
  readonly caretMarkIds: Accessor<readonly string[] | null>;
  /** Source `$getMarkIdsAtCaret` at a range selection's anchor: null when no
   *  comment touches it (and for any other selection kind), otherwise the
   *  mark's ids, which can be empty for an id-less mark. */
  caretCommentIds(selection: ViewSelection): readonly string[] | null;
  captureSelection(): NativeCommentBookmark | null;
  /** Current model points of a bookmark's durable cursors; null once deleted. */
  resolveBookmark(
    bookmark: NativeCommentBookmark
  ): { readonly anchor: Point; readonly focus: Point } | null;
  /** Current Source draft quote; unavailable after retirement or unresolved range. */
  draftText(
    markId: string,
    bookmark: NativeCommentBookmark
  ): string | undefined;
  /** True only when the session accepted the mark; expectedText is captured before flush. */
  publish(
    markId: string,
    bookmark: NativeCommentBookmark,
    expectedText?: string
  ): Promise<boolean>;
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
  const [caretMarkIds, setCaretMarkIds] = createSignal<
    readonly string[] | null
  >(null);
  // Comment-mark keys and their ids; maintained from sparse commit mutations.
  const marks = new Map<NodeKey, readonly string[]>();
  let selected: readonly string[] = [];
  const listeners = new Set<(commit: NativeCommentCommit) => void>();
  const change = (
    key: NodeKey,
    before: readonly string[] | undefined
  ): NativeCommentMarkChange => {
    const current = node(key);
    return {
      key,
      before,
      after: marks.get(key),
      element: view.getElementByKey(key),
      isDraft: current?.props().isDraft === true,
    };
  };
  const remainingIds = () => new Set([...marks.values()].flat());
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
  // Source $getMarkIdsAtCaret.
  const caretCommentIds = (selection: ViewSelection): string[] | null => {
    if (selection.kind !== 'range') return null;
    const { key, offset } = selection.anchor;
    const anchor = node(key);
    if (!anchor) return null;
    if (anchor.kind === 'text') {
      const ids = getMarkIds(key, offset);
      if (ids) return ids;
      if (offset !== 0) return null;
      const parent = node(anchor.parent);
      const index = parent?.children.indexOf(key) ?? -1;
      const previous =
        parent && index > 0 ? node(parent.children[index - 1]) : null;
      if (previous?.kind === 'text')
        return getMarkIds(previous.key, previous.text.length);
      if (previous?.type === 'comment-mark') return markIds(previous);
      return null;
    }
    return anchor.type === 'comment-mark' ? markIds(anchor) : null;
  };
  const readCaretMarkIds = (): string[] | null => {
    const { selection } = view.selection();
    // Source returns early for a null selection and clears for other kinds.
    if (selection.kind === 'none' || selection.kind === 'keep') return null;
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
    const changes: NativeCommentMarkChange[] = [];
    if (commit.fullReconcile) {
      const previous = new Map(marks);
      rebuild();
      for (const key of new Set([...previous.keys(), ...marks.keys()]))
        changes.push(change(key, previous.get(key)));
    } else
      for (const key of new Set([
        ...commit.mutations.keys(),
        ...commit.properties,
      ]))
        if (marks.has(key) || node(key)?.type === 'comment-mark') {
          const before = marks.get(key);
          index(key);
          changes.push(change(key, before));
        }
    if (changes.length) {
      publishAnchors();
      applySelected(selected);
    }
    setCaretMarkIds(readCaretMarkIds());
    const event: NativeCommentCommit = {
      changes,
      selectionChanged: commit.selectionChanged,
      remainingIds: remainingIds(),
    };
    for (const listener of [...listeners]) listener(event);
  });

  const reply = async (
    markId: string,
    action: Parameters<SessionPort['comment']>[1],
    /** Generation at request start; the request needs the same live view. */
    generation: number | null
  ): Promise<boolean> => {
    const span = Telemetry.span('comment.mark.publish');
    span.setAttr('comment.action', action.kind);
    span.setAttr('comment.mark_id', markId);
    // Source publishCommentMark reports each refused publication.
    const refuse = (reason: string) => {
      Telemetry.warn('comment.mark.publication_failed', {
        'comment.mark_id': markId,
        'comment.action': action.kind,
        'comment.reason': reason,
      });
      return false;
    };
    try {
      // Source flushCollaboration: local edits are delivered before the mark
      // changes; a read-only session has none to deliver.
      const flushed = await port.flush();
      span.setAttr('comment.flush', flushed.kind);
      if (flushed.kind !== 'drained' && flushed.kind !== 'read-only')
        return refuse(flushed.kind === 'offline' ? 'offline' : 'not_flushed');
      // Source changeCommentMark rechecks its owner after async staging.
      if (disposed || generation !== view.mirror.keyGeneration) return false;
      const result = await port.comment(markId, action);
      span.setAttr('comment.reply', result.kind);
      return match(result)
        .with({ kind: 'accepted' }, () => true)
        .with({ kind: 'not-acked' }, () => refuse('not_acked'))
        .with({ kind: 'refused' }, ({ reason }) => {
          span.setAttr('comment.refusal', reason);
          return refuse(reason);
        })
        .exhaustive();
    } finally {
      span.end();
    }
  };

  return {
    view,
    root: view.root,
    markIds: (key) => marks.get(key),
    snapshot: () => [...marks.keys()].map((key) => change(key, undefined)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    anchors,
    caretMarkIds,
    caretCommentIds,
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
    resolveBookmark(bookmark) {
      if (disposed || view.mirror.keyGeneration === null) return null;
      return port.resolveCommentSelection(bookmark.cursors);
    },
    draftText(markId, bookmark) {
      if (disposed || bookmark.generation !== view.mirror.keyGeneration)
        return undefined;
      return port.commentDraftText(bookmark.cursors, markId);
    },
    publish(markId, bookmark, expectedText = bookmark.cursors.text) {
      if (disposed || bookmark.generation !== view.mirror.keyGeneration)
        return Promise.resolve(false);
      return reply(
        markId,
        { kind: 'add', ...bookmark.cursors, text: expectedText },
        bookmark.generation
      );
    },
    remove(markId) {
      if (disposed) return Promise.resolve(false);
      return reply(markId, { kind: 'remove' }, view.mirror.keyGeneration);
    },
    select(ids) {
      selected = ids;
      applySelected(ids);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      release();
    },
  };
}
