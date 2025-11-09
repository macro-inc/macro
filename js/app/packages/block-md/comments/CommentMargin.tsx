import {
  activeCommentThreadSignal,
  commentsStore,
  commentWidthSignal,
  highlightedCommentThreadsSignal,
  showCommentsPreference,
  threadStore,
} from '@block-md/comments/commentStore';
import { useBlockId } from '@core/block';
import { MinimizedThread } from '@core/collab/comments/MinimizedThreads';
import {
  CommentsContext,
  type CommentsContextType,
  Thread,
} from '@core/collab/comments/Thread';
import { useCanComment, useIsDocumentOwner } from '@core/signal/permissions';
import { autoUpdate, computePosition } from '@floating-ui/dom';
import { useUserId } from '@service-gql/client';
import {
  createEffect,
  createMemo,
  createSelector,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import {
  notebookHeight,
  threadHeightStore,
  threadsPositionStore,
} from './commentLayout';
import {
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
} from './commentOperations';

const useCommentsContext = (): CommentsContextType => {
  const comments = commentsStore.get;
  const setActiveThread = activeCommentThreadSignal.set;
  const setThreadHeight = threadHeightStore.set;
  const ownedCommentIds = createMemo(() => {
    const userId = useUserId()();
    if (!userId) {
      console.error('User ID not found, cannot get owned comment placeables');
      return [];
    }
    const owned = Object.values(commentsStore.get)
      .filter((c) => !!c)
      .filter((c) => c.owner === userId)
      .map((c) => c.id);
    return owned;
  });
  const ownedCommentSelector = createSelector(
    ownedCommentIds,
    (id: number, owned) => (owned ?? []).includes(id)
  );

  const createComment = useCreateComment();
  const updateComment = useUpdateComment();
  const deleteComment = useDeleteComment();

  const documentId = useBlockId();
  const isDocumentOwner = useIsDocumentOwner();
  const canComment = useCanComment();

  const getCommentById = (id: number) => comments[id];

  const commentsContext: CommentsContextType = {
    setActiveThread,
    setThreadHeight,
    canComment,
    isDocumentOwner,
    getCommentById,
    documentId,
    ownedComment: ownedCommentSelector,
    commentOperations: {
      createComment,
      deleteComment,
      updateComment,
    },
    inComment: true,
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
    if (set.has(-1)) {
      return new Set([-1]);
    }

    return set;
  });
  const isActiveSelector = createSelector(activeThreads, (id: number, ids) => {
    return ids.has(id);
  });

  const commentsContext = useCommentsContext();

  const isMinimized = createMemo(() => {
    return !(wideEnoughForComments() && showCommentsPreference());
  });

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
