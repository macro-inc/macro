import {
  activeCommentThreadSignal,
  commentWidthSignal,
  highlightedCommentIdSignal,
  highlightedCommentThreadsSignal,
  threadStore,
} from '@block-md/comments/commentStore';
import { useBlockId } from '@core/block';
import { MinimizedThread } from '@core/comments/MinimizedThreads';
import {
  CommentsContext,
  type CommentsContextType,
  Thread,
} from '@core/comments/Thread';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useCanComment, useIsDocumentOwner } from '@core/signal/permissions';
import { autoUpdate, computePosition } from '@floating-ui/dom';
import {
  createEffect,
  createMemo,
  createSelector,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { CommentThreadDrawer } from './CommentThreadDrawer';
import {
  notebookHeight,
  threadHeightStore,
  threadsPositionStore,
} from './commentLayout';
import { useCreateComment } from './commentOperations';

const useCommentsContext = (): CommentsContextType => {
  const setActiveThread = activeCommentThreadSignal.set;
  const setThreadHeight = threadHeightStore.set;
  const createComment = useCreateComment();

  const documentId = useBlockId();
  const isDocumentOwner = useIsDocumentOwner();
  const canComment = useCanComment();

  const commentsContext: CommentsContextType = {
    setActiveThread,
    setThreadHeight,
    canComment,
    isDocumentOwner,
    documentId,
    commentOperations: {
      createComment,
    },
    highlightedCommentId: highlightedCommentIdSignal.get,
  };
  return commentsContext;
};

export const CommentMargin = () => {
  const threads = threadStore.get;
  const positions = threadsPositionStore.get;
  const maxHeight = createMemo(() => notebookHeight());

  const wideEnoughForComments = commentWidthSignal.get;

  // NOTE: this is a big of a hack because you can select
  // multiple threads at once from the editor but only one thread in the margin
  const activeThreads = createMemo(() => {
    const highlighted = highlightedCommentThreadsSignal();
    const set = new Set(highlighted);
    const active = activeCommentThreadSignal();
    if (active != null) {
      set.add(active);
    }

    // new threads will take priority
    if (set.has('draft')) {
      return new Set(['draft']);
    }

    return set;
  });
  const isActiveSelector = createSelector(activeThreads, (id: string, ids) => {
    return ids.has(id);
  });

  const commentsContext = useCommentsContext();

  // Touch devices never expand floating thread cards; the active thread is
  // presented in the CommentThreadDrawer instead.
  const isMinimized = createMemo(
    () => isTouchDevice() || !wideEnoughForComments()
  );

  return (
    <CommentsContext.Provider value={commentsContext}>
      <div class="relative h-full">
        <For each={Object.values(threads)}>
          {(thread) => (
            <Show when={thread}>
              {(thread) => {
                const layout = () => positions[thread().anchorId]?.layout;
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
                              isActive={isActiveSelector(thread().threadId)}
                              maxHeight={maxHeight()}
                              expandable={!isTouchDevice()}
                            />
                          }
                        >
                          <Thread
                            comment={thread()}
                            layout={layout()}
                            isActive={isActiveSelector(thread().threadId)}
                            maxHeight={maxHeight()}
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
