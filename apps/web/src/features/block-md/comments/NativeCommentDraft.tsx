import type {
  NativeCommentBookmark,
  NativeComments,
} from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-comments';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import {
  createDOMRange,
  createRectsFromDOMRange,
} from '@macro-inc/lexical-wasm-view/view/selection';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createSignal, For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { v7 } from 'uuid';
import type { DraftPublication } from './LocalCommentDraft';

/** Engine-neutral draft lifecycle the shared comment operations call. */
export interface CommentDraftControls {
  current(): string | undefined;
  /** Source CREATE_DRAFT_COMMENT_COMMAND: false without a usable selection. */
  create(): boolean;
  /** Source COMMIT_COMMENT_MARK_COMMAND for the draft. */
  commit(id: string): void;
  /** Source DISCARD_DRAFT_COMMENT_COMMAND. */
  discard(): void;
}

type NativeDraft = {
  id: string;
  bookmark: NativeCommentBookmark;
  pending?: Promise<boolean>;
  published: boolean;
  posting: boolean;
  postUncertain: boolean;
  committed: boolean;
};

interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A native draft is a captured selection bookmark with durable cursors; like
 * the Source draft it never writes the shared tree until publication.
 */
export function createNativeCommentDraft(options: {
  /** Source markSelected for the draft's id. */
  select: (ids: readonly string[]) => void;
  view: EditorView;
  comments: NativeComments;
  userId: Accessor<string | undefined>;
  hasPostedComment: (markId: string) => Promise<boolean>;
  add: (id: string, anchor: HTMLElement, publication: DraftPublication) => void;
  remove: (id: string) => void;
}) {
  const { view, comments } = options;
  const [draft, setDraft] = createSignal<NativeDraft>();
  const [rects, setRects] = createSignal<readonly Rect[]>([]);
  const anchorElement = document.createElement('span');
  anchorElement.dataset.commentDraftAnchor = '';
  anchorElement.style.cssText = 'position:absolute;pointer-events:none';
  let disposed = false;
  const mount = () => view.root.parentElement;

  // Source LocalCommentDraft refreshes its highlight from the draft range.
  const refresh = () => {
    const current = draft();
    const parent = mount();
    // Durable cursors follow edits and key changes inside the range.
    const points = current ? comments.resolveBookmark(current.bookmark) : null;
    if (!points || !parent) {
      setRects([]);
      return;
    }
    const { anchor, focus } = points;
    const range = createDOMRange(view, anchor, focus);
    if (!range || range.collapsed) {
      setRects([]);
      return;
    }
    const origin = parent.getBoundingClientRect();
    const next = createRectsFromDOMRange(range).map((rect) => ({
      left: rect.left - origin.left,
      top: rect.top - origin.top,
      width: rect.width,
      height: rect.height,
    }));
    setRects(next);
    const bounds = range.getBoundingClientRect();
    Object.assign(anchorElement.style, {
      left: `${bounds.left - origin.left}px`,
      top: `${bounds.top - origin.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
    });
  };
  onCleanup(view.onCommit(refresh));

  // A published but never-posted mark is removed again, as Source cleanup does.
  const cleanupPublished = async (record: NativeDraft) => {
    if (!record.published || record.committed || record.posting) return;
    if (record.postUncertain) return;
    if (await options.hasPostedComment(record.id)) return;
    if (!(await comments.remove(record.id)))
      Telemetry.warn('comment.draft.cleanup_refused', {
        'comment.mark_id': record.id,
      });
  };
  const clear = (committed: boolean) => {
    const current = draft();
    if (current && committed) current.committed = true;
    setDraft();
    setRects([]);
    anchorElement.remove();
    if (!current) return;
    options.remove(current.id);
    if (!current.pending && !committed)
      fireAndForget(cleanupPublished(current), 'native-comment-draft-cleanup');
  };
  onCleanup(() => {
    disposed = true;
    clear(false);
  });

  const controls: CommentDraftControls = {
    current: () => draft()?.id,
    create() {
      if (disposed || !options.userId()) return false;
      // Retrying Comment while a composer is open reselects that draft.
      const existing = draft();
      if (existing) {
        options.select([existing.id]);
        return true;
      }
      const id = v7();
      const parent = mount();
      if (!parent) return false;
      const bookmark = comments.captureSelection();
      if (!bookmark) return false;
      const record: NativeDraft = {
        id,
        bookmark,
        published: false,
        posting: false,
        postUncertain: false,
        committed: false,
      };
      setDraft(record);
      const active = () => !disposed && draft() === record;
      parent.append(anchorElement);
      refresh();
      options.add(id, anchorElement, {
        text: () =>
          active() ? comments.draftText(id, record.bookmark) : undefined,
        publish: () => {
          if (!active()) return Promise.resolve(false);
          if (record.pending) return record.pending;
          // Source snapshots this independently of the message quote read,
          // before the asynchronous flush; the original cursor capture stays immutable.
          const selectedText = comments.draftText(id, record.bookmark);
          if (!selectedText || !active()) return Promise.resolve(false);
          const publish = async () => {
            try {
              const accepted = await comments.publish(
                id,
                record.bookmark,
                selectedText
              );
              if (accepted) record.published = true;
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
                'comment.mark_id': record.id,
              });
            if (disposed || draft() !== record) await cleanupPublished(record);
          }
        },
      });
      options.select([id]);
      return true;
    },
    commit: () => clear(true),
    discard: () => clear(false),
  };

  const Highlight = () => (
    <Show when={mount()}>
      {(parent) => (
        <Portal mount={parent()}>
          <For each={rects()}>
            {(rect) => (
              <div
                data-comment-draft-highlight=""
                class="absolute pointer-events-none bg-comment-bg"
                style={{
                  left: `${rect.left}px`,
                  top: `${rect.top}px`,
                  width: `${rect.width}px`,
                  height: `${rect.height}px`,
                }}
              />
            )}
          </For>
        </Portal>
      )}
    </Show>
  );

  return { controls, Highlight };
}
