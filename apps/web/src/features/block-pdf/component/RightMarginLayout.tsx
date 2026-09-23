import {
  GUTTER_MARGIN,
  MIN_RIGHT_COLUMN_WIDTH,
  THREAD_WIDTH,
} from '@block-pdf/signal/viewerThreeColumnLayout';
import { usePageCommentLayout } from '@block-pdf/store/comments/commentLayout';
import {
  useCreateComment,
  useCreateMessageComment,
  useDeleteComment,
  useUpdateComment,
} from '@block-pdf/store/comments/commentOperations';
import type { CommentId, ThreadId } from '@core/comments/commentType';
import {
  baseCommentTheme,
  CommentsContext,
  type CommentsContextType,
  noopCommentOperations,
  Thread,
} from '@core/comments/Thread';
import { useUserId } from '@core/context/user';
import { Key } from '@solid-primitives/keyed';
import { createSelector } from 'solid-js';
import { usePdfComments } from '../context/pdf-comments-context';
import { usePdfDocument } from '../context/pdf-document-context';

const rightMarginStyle = {
  minWidth: `${MIN_RIGHT_COLUMN_WIDTH}px`,
  width: `${THREAD_WIDTH - GUTTER_MARGIN * 2}px`,
  right: `${-THREAD_WIDTH + GUTTER_MARGIN}px`,
};

export function RightMarginLayout(props: { pageIndex: number }) {
  return (
    <div
      class="rightMargin absolute top-0 z-pdf-comments pointer-events-auto [transition: width 0.05s linear, right 0.05s linear]"
      style={rightMarginStyle}
    >
      <CommentsAndSuggestions pageIndex={props.pageIndex} />
    </div>
  );
}

function useCommentOperations(): Pick<
  CommentsContextType,
  'commentOperations' | 'messageOperations'
> {
  if (usePdfDocument().annotations.unified) {
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
  const pdf = usePdfDocument();
  const comments = usePdfComments();
  const commentsById = comments.byId;
  const setActiveThread = (threadId: ThreadId | null) => {
    if (threadId == null) {
      comments.clearActiveThread();
    } else {
      comments.activateThread(threadId);
    }
  };

  const operations = useCommentOperations();

  const userId = useUserId();
  const ownedComment = (id: CommentId) => {
    const currentUserId = userId();
    return (
      currentUserId != null && commentsById().get(id)?.owner === currentUserId
    );
  };
  const getCommentById = (id: CommentId) => commentsById().get(id);

  const commentsContext: CommentsContextType = {
    setActiveThread,
    setThreadHeight,
    canComment: () => !pdf.isNested() && pdf.permissions.canComment(),
    isDocumentOwner: pdf.permissions.isOwner,
    getCommentById,
    documentId: pdf.documentId(),
    documentType: 'pdf',
    ownedComment,
    ...operations,
    inComment: true,
    highlightedCommentId: () => null,
  };

  return commentsContext;
};

function CommentsAndSuggestions(props: { pageIndex: number }) {
  const comments = usePdfComments();
  const { threads, setThreadHeight } = usePageCommentLayout(
    () => props.pageIndex
  );

  const isActiveThreadSelector = createSelector(comments.activeThreadId);

  const isSelectingThreadSelector = createSelector(comments.selectedThreadId);

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
    comments.selectThread(threadId);

    const handleMouseUp = (e: MouseEvent) => {
      e.stopPropagation();
      comments.activateThread(threadId);
      document.removeEventListener('mouseup', handleMouseUp, true);
    };
    document.addEventListener('mouseup', handleMouseUp, true);
  };

  const commentsContext = useCommentsContext(setThreadHeight);

  return (
    <CommentsContext.Provider value={commentsContext}>
      <Key each={threads()} by="threadId">
        {(root) => (
          <Thread
            comment={root()}
            layout={root().layout}
            isActive={isActiveThreadSelector(root().threadId)}
            theme={commentTheme(root().threadId)}
            handleMouseDown={handleThreadMouseDown(root().threadId)}
          />
        )}
      </Key>
    </CommentsContext.Provider>
  );
}
