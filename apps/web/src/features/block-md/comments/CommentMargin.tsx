import {
  isDraftThreadId,
  type Root,
  type ThreadId,
} from '@core/comments/commentType';
import { MinimizedThread } from '@core/comments/MinimizedThreads';
import {
  CommentsContext,
  type CommentsContextType,
  Thread,
} from '@core/comments/Thread';
import { MARK_SELECTED_COMMENT_COMMAND } from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { autoUpdate, computePosition } from '@floating-ui/dom';
import {
  createEffect,
  createMemo,
  createSelector,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { CommentThreadDrawer } from './CommentThreadDrawer';
import { createCommentLayout } from './commentLayout';
import { useCreateMessageComment } from './messageCommentOperations';

const useCommentsContext = (
  setThreadHeight: CommentsContextType['setThreadHeight']
): CommentsContextType => {
  const { documentId, kind, permissions, state } = useMarkdownDocument();
  const documentKind = kind();
  const { comments: commentState, setCommentState } = state;
  const createComment = useCreateMessageComment();

  const commentsContext: CommentsContextType = {
    setActiveThread: (threadId) => {
      setCommentState('activeCommentThread', threadId);
      // Activating a thread selects its mark, and a selected mark keeps its
      // thread active, so releasing the thread releases the mark too.
      if (threadId === null) {
        state.editor.md.editor?.dispatchCommand(
          MARK_SELECTED_COMMENT_COMMAND,
          []
        );
      }
    },
    setThreadHeight,
    canComment: permissions.canComment,
    isDocumentOwner: permissions.isOwner,
    documentId: documentId(),
    documentType: documentKind === 'document' ? 'md' : documentKind,
    messageOperations: { createComment },
    highlightedCommentId: () => commentState.highlightedCommentId,
    clearHighlightedComment: () =>
      setCommentState('highlightedCommentId', null),
  };
  return commentsContext;
};

export const CommentMargin = (props: { wideEnough: boolean }) => {
  const { state } = useMarkdownDocument();
  const commentState = state.comments;
  const { setThreadHeights, threadPositions } = createCommentLayout();

  // NOTE: this is a big of a hack because you can select
  // multiple threads at once from the editor but only one thread in the margin
  const activeThreads = createMemo(() => {
    const highlighted = commentState.highlightedCommentThreads;
    const set = new Set(highlighted);
    const active = commentState.activeCommentThread;
    if (active != null) {
      set.add(active);
    }

    // new threads will take priority
    const draft = [...set].find(isDraftThreadId);
    if (draft !== undefined) {
      return new Set([draft]);
    }

    return set;
  });
  const isActiveSelector = createSelector(
    activeThreads,
    (id: ThreadId, ids) => {
      return ids.has(id);
    }
  );

  // A caret inside resolved text does not unfold its thread; only opening it
  // from the margin or a link does.
  const isThreadActive = (thread: Root) =>
    isActiveSelector(thread.threadId) &&
    (!thread.resolved || commentState.activeCommentThread === thread.threadId);

  const commentsContext = useCommentsContext(setThreadHeights);

  let marginRef!: HTMLDivElement;
  const hasOpenThread = createMemo(() =>
    [...activeThreads()].some((id) => !isDraftThreadId(id))
  );
  // An open thread closes when a press lands outside the comments. The
  // editor is left to its selection sync, and layers portaled beside the app
  // (a card's menus and delete confirmation) belong to the card that opened
  // them. A draft keeps its composer, and touch uses the drawer's dismissal.
  createEffect(() => {
    if (!hasOpenThread() || isTouchDevice()) return;
    const app = appRootOf(marginRef);
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node) || !app.contains(target)) return;
      if (marginRef.contains(target)) return;
      if (state.editor.md.editor?.getRootElement()?.contains(target)) return;
      commentsContext.setActiveThread(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    onCleanup(() =>
      document.removeEventListener('pointerdown', onPointerDown, true)
    );
  });

  // Touch devices never expand floating thread cards; the active thread is
  // presented in the CommentThreadDrawer instead.
  const isMinimized = createMemo(() => isTouchDevice() || !props.wideEnough);

  return (
    <CommentsContext.Provider value={commentsContext}>
      <div ref={marginRef} class="relative h-full">
        <For each={Object.values(commentState.threads)}>
          {(thread) => (
            <Show when={thread}>
              {(thread) => {
                const layout = () => threadPositions[thread().anchorId]?.layout;
                return (
                  <Show when={layout()}>
                    {(layout) => (
                      <div>
                        <Show
                          when={!isMinimized()}
                          fallback={
                            <MinimizedThread
                              comment={thread()}
                              layout={layout()}
                              isActive={isThreadActive(thread())}
                              expandable={!isTouchDevice()}
                            />
                          }
                        >
                          <Thread
                            comment={thread()}
                            layout={layout()}
                            isActive={isThreadActive(thread())}
                          />
                        </Show>
                      </div>
                    )}
                  </Show>
                );
              }}
            </Show>
          )}
        </For>
      </div>
      <Show when={isTouchDevice()}>
        <CommentThreadDrawer />
      </Show>
    </CommentsContext.Provider>
  );
};

/** The element under `<body>` that holds `el`: the app, or the portal it renders in. */
function appRootOf(el: HTMLElement): HTMLElement {
  let root = el;
  while (root.parentElement && root.parentElement !== el.ownerDocument.body) {
    root = root.parentElement;
  }
  return root;
}

/**
 *
 * TODO: this could be useful to provide default positioning
 * if the existing layout stuff fails but stretch goal for now
 *
 * Floats an element anchored to another element that moves dynamically.
 */
export function floatWithElement(
  floatingEl: HTMLElement,
  element: () => Element | undefined | null
) {
  Object.assign(floatingEl.style, { position: 'absolute' });
  let referenceEl: Element | null;
  let cleanup: () => void = () => {};

  async function updatePosition() {
    if (!referenceEl) {
      Object.assign(floatingEl.style, { display: 'none' });
      return;
    }

    const { y } = await computePosition(referenceEl, floatingEl, {
      placement: 'right',
    });

    Object.assign(floatingEl.style, {
      top: `${y}px`,
    });
  }

  createEffect(() => {
    cleanup();
    referenceEl = element() ?? null;
    if (!referenceEl) return;

    cleanup = autoUpdate(referenceEl, floatingEl, updatePosition);
  });

  onCleanup(() => {
    cleanup();
  });
}
