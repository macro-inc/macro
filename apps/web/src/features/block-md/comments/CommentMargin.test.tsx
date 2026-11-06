import {
  DRAFT_THREAD_ID,
  type Root,
  type ThreadId,
} from '@core/comments/commentType';
import type { CommentsContextType } from '@core/comments/Thread';
import { MARK_SELECTED_COMMENT_COMMAND } from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { Dialog } from '@kobalte/core/dialog';
import { CommentNode } from '@macro-inc/lexical-core';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { COMMAND_PRIORITY_EDITOR, createEditor } from 'lexical';
import { createContext, createSignal, useContext } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMarkdownDocumentState } from '../context/markdown-document-state';
import { CommentMargin } from './CommentMargin';

const mocks = vi.hoisted(() => ({
  state: undefined as
    | ReturnType<typeof createMarkdownDocumentState>
    | undefined,
}));

vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    documentId: () => 'document',
    kind: () => 'document',
    state: mocks.state,
    permissions: { canComment: () => true, isOwner: () => false },
  }),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('./commentLayout', () => ({
  createCommentLayout: () => ({
    setThreadHeights: () => {},
    threadPositions: { mark: { layout: { calculatedYPos: 0 } } },
  }),
}));
vi.mock('./messageCommentOperations', () => ({
  useCreateMessageComment: () => async () => null,
}));
vi.mock('./CommentThreadDrawer', () => ({ CommentThreadDrawer: () => null }));
vi.mock('@core/comments/MinimizedThreads', () => ({
  MinimizedThread: () => null,
}));
vi.mock('@core/comments/Thread', () => {
  const CommentsContext = createContext<CommentsContextType>();
  return {
    CommentsContext,
    // Stands in for the margin card: clicking it opens its thread, and its
    // delete confirmation renders into a portal outside the app.
    Thread: (props: { comment: Root; isActive: boolean }) => {
      const context = useContext(CommentsContext);
      const [confirming, setConfirming] = createSignal(false);
      return (
        <article
          aria-current={props.isActive}
          onClick={() => context?.setActiveThread(props.comment.threadId)}
        >
          Comment card
          <button onClick={() => setConfirming(true)}>Delete</button>
          <Dialog open={confirming()} onOpenChange={setConfirming}>
            <Dialog.Portal>
              <Dialog.Content>
                <button>Cancel delete</button>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog>
        </article>
      );
    },
  };
});

const comment: Root = {
  id: 'root',
  rootId: 'root',
  threadId: 'root',
  anchorId: 'mark',
  owner: 'user',
  author: 'user',
  text: 'Comment',
  createdAt: '2026-10-22T00:00:00Z',
  isNew: false,
  children: [],
  replyCount: 0,
};

afterEach(() => {
  cleanup();
});

function setup(open?: { active?: ThreadId; highlighted?: ThreadId[] }) {
  const state = createMarkdownDocumentState();
  mocks.state = state;
  state.setCommentState('threads', { root: comment });
  const editor = createEditor({
    namespace: 'comment-margin',
    nodes: [CommentNode],
    onError: (error) => {
      throw error;
    },
  });
  const releasedMarks = vi.fn();
  editor.registerCommand(
    MARK_SELECTED_COMMENT_COMMAND,
    (ids) => {
      if (ids.length === 0) releasedMarks();
      return true;
    },
    COMMAND_PRIORITY_EDITOR
  );
  state.editor.setMd('editor', editor);
  render(() => (
    <div>
      <button>Sidebar</button>
      <div data-testid="editor" />
      <CommentMargin wideEnough />
    </div>
  ));
  editor.setRootElement(screen.getByTestId('editor'));
  if (open?.active !== undefined) {
    state.setCommentState('activeCommentThread', open.active);
  }
  if (open?.highlighted) {
    state.setCommentState('highlightedCommentThreads', open.highlighted);
  }
  // The modal delete confirmation hides the card from the accessibility tree.
  const card = () => screen.getByRole('article', { hidden: true });
  return { state, card, releasedMarks };
}

describe('CommentMargin', () => {
  it('closes a thread opened from its card when a press lands outside the comments', () => {
    const { state, card, releasedMarks } = setup();
    fireEvent.click(card());
    expect(card().getAttribute('aria-current')).toBe('true');

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Sidebar' }));

    expect(card().getAttribute('aria-current')).toBe('false');
    expect(state.comments.activeCommentThread).toBeNull();
    expect(releasedMarks).toHaveBeenCalledOnce();
  });

  it('keeps the thread open for presses on the editor, the card, and the layers it opened', async () => {
    const { card, releasedMarks } = setup({ active: 'root' });

    fireEvent.pointerDown(screen.getByTestId('editor'));
    fireEvent.pointerDown(card());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.pointerDown(
      await screen.findByRole('button', { name: 'Cancel delete' })
    );

    expect(card().getAttribute('aria-current')).toBe('true');
    expect(releasedMarks).not.toHaveBeenCalled();
  });

  it('releases a thread highlighted by the caret when a press lands outside', () => {
    const { releasedMarks } = setup({ highlighted: ['root'] });

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Sidebar' }));

    expect(releasedMarks).toHaveBeenCalledOnce();
  });

  it('leaves a draft comment open', () => {
    const { state, releasedMarks } = setup({ active: DRAFT_THREAD_ID });

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Sidebar' }));

    expect(state.comments.activeCommentThread).toBe(DRAFT_THREAD_ID);
    expect(releasedMarks).not.toHaveBeenCalled();
  });
});
