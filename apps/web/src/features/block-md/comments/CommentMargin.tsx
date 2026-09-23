import {
  type CommentId,
  isDraftThreadId,
  type Root,
  type ThreadId,
} from '@core/comments/commentType';
import { MinimizedThread } from '@core/comments/MinimizedThreads';
import {
  CommentsContext,
  type CommentsContextType,
  noopCommentOperations,
  Thread,
} from '@core/comments/Thread';
import {
  enableUnifiedDocumentDiscussions,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
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
import {
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
} from './commentOperations';
import { useCreateMessageComment } from './messageCommentOperations';

function useCommentOperations(): Pick<
  CommentsContextType,
  'commentOperations' | 'messageOperations'
> {
  if (isFeatureEnabled(enableUnifiedDocumentDiscussions)) {
    return {
      commentOperations: noopCommentOperations,
      messageOperations: { createComment: useCreateMessageComment() },
    };
  }
  return {
    commentOperations: {
      createComment: useCreateComment(),
      deleteComment: useDeleteComment(),
      updateComment: useUpdateComment(),
    },
  };
}

const useCommentsContext = (
  setThreadHeight: CommentsContextType['setThreadHeight']
): CommentsContextType => {
  const { documentId, kind, permissions, state } = useMarkdownDocument();
  const documentKind = kind();
  const { comments: commentState, setCommentState } = state;
  const ownedCommentIds = createMemo(() => {
    const userId = useUserId()();
    if (!userId) {
      console.error('User ID not found, cannot get owned comment placeables');
      return [];
    }
    const owned = Object.values(commentState.comments)
      .filter((c) => !!c)
      .filter((c) => c.owner === userId)
      .map((c) => c.id);
    return owned;
  });
  const ownedCommentSelector = createSelector(
    ownedCommentIds,
    (id: CommentId, owned) => (owned ?? []).includes(id)
  );

  const operations = useCommentOperations();

  const getCommentById = (id: CommentId) => commentState.comments[id];

  const commentsContext: CommentsContextType = {
    setActiveThread: (threadId) =>
      setCommentState('activeCommentThread', threadId),
    setThreadHeight,
    canComment: permissions.canComment,
    isDocumentOwner: permissions.isOwner,
    getCommentById,
    documentId: documentId(),
    documentType: documentKind === 'document' ? 'md' : documentKind,
    ownedComment: ownedCommentSelector,
    ...operations,
    inComment: true,
    highlightedCommentId: () => commentState.highlightedCommentId,
  };
  return commentsContext;
};

export const CommentMargin = (props: { wideEnough: boolean }) => {
  const { state } = useMarkdownDocument();
  const commentState = state.comments;
  const { notebookHeight, setThreadHeights, threadPositions } =
    createCommentLayout();
  const maxHeight = createMemo(() => notebookHeight() ?? undefined);

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

  // Touch devices never expand floating thread cards; the active thread is
  // presented in the CommentThreadDrawer instead.
  const isMinimized = createMemo(() => isTouchDevice() || !props.wideEnough);

  return (
    <CommentsContext.Provider value={commentsContext}>
      <div class="relative h-full">
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
                              maxHeight={maxHeight()}
                              expandable={!isTouchDevice()}
                            />
                          }
                        >
                          <Thread
                            comment={thread()}
                            layout={layout()}
                            isActive={isThreadActive(thread())}
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
