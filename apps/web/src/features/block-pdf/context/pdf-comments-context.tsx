import type { ThreadId } from '@core/comments/commentType';
import {
  type Accessor,
  createContext,
  createMemo,
  createSignal,
  type FlowComponent,
  useContext,
} from 'solid-js';
import type { CommentStore } from '../type/comments';

type PdfCommentsContextValue = {
  all: Accessor<CommentStore>;
  byId: Accessor<Map<number, CommentStore[number]>>;
  activeThreadId: Accessor<ThreadId | null>;
  selectedThreadId: Accessor<ThreadId | null>;
  scrollingSuppressed: Accessor<boolean>;
  activateThread: (threadId: ThreadId) => void;
  clearActiveThread: () => void;
  selectThread: (threadId: ThreadId) => void;
  clearSelectedThread: () => void;
  suppressScrolling: () => void;
  restoreScrolling: () => void;
};

const PdfCommentsContext = createContext<PdfCommentsContextValue>();

export const PdfCommentsProvider: FlowComponent<{
  comments: Accessor<CommentStore>;
}> = (props) => {
  const [activeThreadId, setActiveThreadId] = createSignal<ThreadId | null>(
    null
  );
  const [selectedThreadId, setSelectedThreadId] = createSignal<ThreadId | null>(
    null
  );
  const [scrollingSuppressed, setScrollingSuppressed] = createSignal(false);
  const byId = createMemo(() => {
    const comments = new Map<number, CommentStore[number]>();
    for (const comment of props.comments()) comments.set(comment.id, comment);
    return comments;
  });

  return (
    <PdfCommentsContext.Provider
      value={{
        all: props.comments,
        byId,
        activeThreadId,
        selectedThreadId,
        scrollingSuppressed,
        activateThread: setActiveThreadId,
        clearActiveThread: () => setActiveThreadId(null),
        selectThread: setSelectedThreadId,
        clearSelectedThread: () => setSelectedThreadId(null),
        suppressScrolling: () => setScrollingSuppressed(true),
        restoreScrolling: () => setScrollingSuppressed(false),
      }}
    >
      {props.children}
    </PdfCommentsContext.Provider>
  );
};

export function usePdfComments() {
  const context = useContext(PdfCommentsContext);
  if (!context) {
    throw new Error('usePdfComments must be used within PdfCommentsProvider');
  }
  return context;
}
