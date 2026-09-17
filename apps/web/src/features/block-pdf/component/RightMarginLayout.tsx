import {
  GUTTER_MARGIN,
  MIN_RIGHT_COLUMN_WIDTH,
} from '@block-pdf/signal/viewerThreeColumnLayout';
import {
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
} from '@block-pdf/store/comments/commentOperations';
import type { CommentId, ThreadId } from '@core/comments/commentType';
import {
  baseCommentTheme,
  CommentsContext,
  type CommentsContextType,
  Thread,
} from '@core/comments/Thread';
import { useUserId } from '@core/context/user';
import { createMemo, createSelector, For } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';

export function RightMarginLayout(props: { pageNumber: number }) {
  const [viewerThreeColumnLayout] =
    usePdfDocument().state.signals.viewerThreeColumnLayout;
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

const useCommentsContext = (): CommentsContextType => {
  const pdf = usePdfDocument();
  const { signals, stores, derived } = pdf.state;
  const setActiveThread = signals.activeCommentThread[1];
  const setThreadHeight = stores.threadHeight[1];

  const createComment = useCreateComment();
  const updateComment = useUpdateComment();
  const deleteComment = useDeleteComment();

  const userId = useUserId();
  const ownedComment = (id: CommentId) => {
    const currentUserId = userId();
    return (
      currentUserId != null &&
      derived.commentMap()?.get(id)?.owner === currentUserId
    );
  };
  const getCommentById = (id: CommentId) => derived.commentMap()?.get(id);

  const commentsContext: CommentsContextType = {
    setActiveThread,
    setThreadHeight,
    canComment: () => !pdf.isNested() && pdf.permissions.canComment(),
    isDocumentOwner: pdf.permissions.isOwner,
    getCommentById,
    documentId: pdf.documentId(),
    ownedComment,
    commentOperations: {
      createComment,
      deleteComment,
      updateComment,
    },
    inComment: true,
    highlightedCommentId: () => null,
  };

  return commentsContext;
};

function CommentsAndSuggestions(props: { pageNumber: number }) {
  const { signals, stores } = usePdfDocument().state;
  const threadsOnPage = createMemo(
    () => stores.threadsOnPagePosition[0][props.pageNumber] ?? []
  );

  const [activeCommentThread, setActiveThreadId] = signals.activeCommentThread;
  const isActiveThreadSelector = createSelector(activeCommentThread);

  const [selectedThreadId, setSelectedThreadId] =
    signals.selectingCommentThread;
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
