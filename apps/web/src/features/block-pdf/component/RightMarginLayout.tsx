import { selectingCommentThreadSignal } from '@block-pdf/signal/click';
import { useOwnedCommentSelector } from '@block-pdf/signal/permissions';
import {
  GUTTER_MARGIN,
  MIN_RIGHT_COLUMN_WIDTH,
  viewerThreeColumnLayout,
} from '@block-pdf/signal/viewerThreeColumnLayout';
import {
  threadHeightStore,
  threadsOnPagePositionStore,
} from '@block-pdf/store/comments/commentLayout';
import {
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
} from '@block-pdf/store/comments/commentOperations';
import {
  activeCommentThreadSignal,
  useGetCommentById,
  useIsActiveThreadSelector,
} from '@block-pdf/store/comments/commentStore';
import { useCreateMessageComment } from '@block-pdf/store/comments/messageCommentOperations';
import { useBlockId, useIsNestedBlock } from '@core/block';
import type { ThreadId } from '@core/comments/commentType';
import {
  baseCommentTheme,
  CommentsContext,
  type CommentsContextType,
  noopCommentOperations,
  Thread,
} from '@core/comments/Thread';
import {
  enableUnifiedDocumentDiscussions,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { useCanComment, useIsDocumentOwner } from '@core/signal/permissions';
import { createMemo, createSelector, For } from 'solid-js';

export function RightMarginLayout(props: { pageNumber: number }) {
  const styles = createMemo(() => {
    const { centerWidth, marginWidth, rightWidth } = viewerThreeColumnLayout();
    if (!centerWidth) return {};
    const baseStyles = {
      minWidth: MIN_RIGHT_COLUMN_WIDTH + 'px',
      width: rightWidth - GUTTER_MARGIN * 2 + 'px',
    };

    const right =
      rightWidth <= MIN_RIGHT_COLUMN_WIDTH ? -marginWidth : -rightWidth;
    return {
      right: right + GUTTER_MARGIN + 'px',
      ...baseStyles,
    };
  });

  return (
    <div
      class="rightMargin absolute [transition: width 0.05s linear, right 0.05s linear]"
      style={styles()}
    >
      <CommentsAndSuggestions pageNumber={props.pageNumber} />
    </div>
  );
}

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

const useCommentsContext = (): CommentsContextType => {
  const isNestedBlock = useIsNestedBlock();

  const setActiveThread = activeCommentThreadSignal.set;
  const setThreadHeight = threadHeightStore.set;

  const operations = useCommentOperations();

  const ownedCommentSelector = useOwnedCommentSelector();

  const documentId = useBlockId();
  const isDocumentOwner = useIsDocumentOwner();
  const hasPermissions = useCanComment();
  const canComment = () => {
    if (isNestedBlock) return false;
    return hasPermissions();
  };

  const getCommentById = useGetCommentById();

  const commentsContext: CommentsContextType = {
    setActiveThread,
    setThreadHeight,
    canComment,
    isDocumentOwner,
    getCommentById,
    documentId,
    ownedComment: ownedCommentSelector,
    ...operations,
    inComment: true,
    highlightedCommentId: () => null,
  };

  return commentsContext;
};

function CommentsAndSuggestions(props: { pageNumber: number }) {
  const threadsOnPage = createMemo(
    () => threadsOnPagePositionStore.get[props.pageNumber] ?? []
  );

  const isActiveThreadSelector = useIsActiveThreadSelector();
  const setActiveThreadId = activeCommentThreadSignal.set;

  const [selectedThreadId, setSelectedThreadId] = selectingCommentThreadSignal;
  const isSelectingThreadSelector = createSelector(selectedThreadId);

  const commentTheme = (threadId: ThreadId | null) => {
    const isSelecting = isSelectingThreadSelector(threadId);
    let theme = {
      ...baseCommentTheme,
      text: {
        ...baseCommentTheme.text,
        base: isSelecting ? 'select-text!' : 'select-none',
      },
    };
    return theme;
  };

  const handleThreadMouseDown = (threadId: ThreadId) => (e: MouseEvent) => {
    e.stopPropagation();
    setSelectedThreadId(threadId);

    const handleMouseUp = (e: MouseEvent) => {
      e.stopPropagation();
      setActiveThreadId(threadId);
      document.removeEventListener('mouseup', handleMouseUp, true);
    };
    document.addEventListener('mouseup', handleMouseUp, true);
  };

  const commentsContext = useCommentsContext();

  return (
    <CommentsContext.Provider value={commentsContext}>
      <For each={threadsOnPage()}>
        {(root) => (
          <Thread
            comment={root}
            layout={root.layout}
            isActive={isActiveThreadSelector(root.threadId)}
            theme={commentTheme(root.threadId)}
            handleMouseDown={handleThreadMouseDown(root.threadId)}
          />
        )}
      </For>
    </CommentsContext.Provider>
  );
}
