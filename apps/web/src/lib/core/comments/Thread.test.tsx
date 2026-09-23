import { URL_PARAMS as markdownParams } from '@block-md/constants';
import { Dialog } from '@kobalte/core/dialog';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Root } from './commentType';
import { MinimizedThread } from './MinimizedThreads';
import {
  CommentsContext,
  type CommentsContextType,
  noopCommentOperations,
  ThreadBody,
} from './Thread';

const mocks = vi.hoisted(() => ({
  unifiedDiscussions: true,
  confirmed: vi.fn(),
  patchThread: vi.fn(),
}));
vi.mock('@queries/messages/mutations', () => ({
  usePatchThreadMutation: () => ({ mutate: mocks.patchThread }),
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@core/util/url', () => ({
  buildSimpleEntityUrl: (
    entity: { type: string; id: string },
    params: Record<string, string>
  ) =>
    `https://macro.test/app/${entity.type}/${entity.id}?${new URLSearchParams(params)}`,
}));
vi.mock('@core/context/user', () => ({ useAuthor: () => () => 'user' }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('./MessageTopRow', () => ({
  MessageTopRow: (props: { copyLink?: () => Promise<void> }) => (
    <button onClick={props.copyLink}>Copy comment link</button>
  ),
}));
vi.mock('./Inputs', () => ({
  EditInput: () => null,
  NewReplyInput: () => null,
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  isFeatureEnabled: () => mocks.unifiedDiscussions,
}));
vi.mock('@channel/Input', () => ({ ChannelInput: () => null }));
vi.mock('@channel/Input/message-payload', () => ({
  buildPostMessageSendPayload: () => ({ message: {} }),
}));
vi.mock('@core/messages/MessageThread', () => ({
  MessageThreadById: (props: {
    buildLink: (message: { id: string }) => string;
  }) => {
    // Stands in for the message actions' delete confirmation, which the
    // thread renders into a portal outside the card.
    const [confirming, setConfirming] = createSignal(false);
    return (
      <>
        <a href={props.buildLink({ id: 'comment-root' })}>Copy link</a>
        <button onClick={() => setConfirming(true)}>Delete</button>
        <Dialog open={confirming()} onOpenChange={setConfirming}>
          <Dialog.Portal>
            <Dialog.Content>
              <button onClick={() => mocks.confirmed()}>Confirm delete</button>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog>
      </>
    );
  },
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: ParentProps) => props.children,
    StaticMarkdown: (props: { markdown: string }) => <p>{props.markdown}</p>,
  })
);
vi.mock('@ui', () => ({
  Button: (props: ParentProps<{ onClick?: (e: MouseEvent) => void }>) => (
    <button onClick={(e) => props.onClick?.(e)}>{props.children}</button>
  ),
  Layer: (props: ParentProps) => props.children,
  cn: (...values: string[]) => values.join(' '),
}));
vi.mock('./MeasureContainer', () => ({
  MeasureContainer: (props: ParentProps) => props.children,
}));

const writeText = vi.fn();
beforeEach(() => {
  mocks.unifiedDiscussions = true;
  mocks.patchThread.mockReset();
  writeText.mockReset();
  vi.stubGlobal('navigator', { clipboard: { writeText } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const comment: Root = {
  id: 'comment-root',
  rootId: 'comment-root',
  threadId: 'comment-root',
  anchorId: 'mark',
  owner: 'user',
  author: 'user',
  text: 'Comment',
  createdAt: '2026-09-09T00:00:00Z',
  isNew: false,
  children: [],
  replyCount: 0,
};

describe('anchored comment links', () => {
  it('counts replies outside the loaded preview in the minimized thread badge', () => {
    const view = render(() => (
      <MinimizedThread
        comment={{
          ...comment,
          children: ['first', 'second', 'third'],
          replyCount: 8,
        }}
        layout={{ calculatedYPos: 0 }}
        isActive={false}
      />
    ));
    expect(view.getByText('9')).toBeTruthy();
    expect(view.queryByText('4')).toBeNull();
  });
  // A document passes message operations exactly when it reads through the
  // message API, which follows the flag unless a test says otherwise.
  const renderThreadBody = (
    documentType: CommentsContextType['documentType'] = 'md',
    minimized = false,
    messageApi = mocks.unifiedDiscussions
  ) =>
    render(() => (
      <CommentsContext.Provider
        value={{
          documentId: 'document',
          documentType,
          canComment: () => true,
          isDocumentOwner: () => true,
          highlightedCommentId: () => null,
          setActiveThread: () => {},
          setThreadHeight: () => {},
          getCommentById: () => ({ ...comment, id: 'reply', text: 'Reply' }),
          ownedComment: () => false,
          inComment: true,
          commentOperations: noopCommentOperations,
          messageOperations: messageApi
            ? { createComment: async () => null }
            : undefined,
        }}
      >
        {minimized ? (
          <MinimizedThread
            comment={comment}
            layout={{ calculatedYPos: 0 }}
            isActive={false}
          />
        ) : (
          <ThreadBody comment={{ ...comment, children: ['reply'] }} isActive />
        )}
      </CommentsContext.Provider>
    ));

  it.each(['md', 'task', 'snippet', 'skill'] as const)(
    'renders %s comment links without a block provider',
    (documentType) => {
      const view = renderThreadBody(documentType);
      const url = new URL(view.getByRole('link').getAttribute('href')!);
      expect(url.pathname).toBe(`/app/${documentType}/document`);
      expect(url.searchParams.get(markdownParams.commentId)).toBe(
        'comment-root'
      );
      expect(url.searchParams.has('commentId')).toBe(false);
    }
  );

  it('renders a PDF on the message API through the message thread', () => {
    const view = renderThreadBody('pdf');
    const url = new URL(view.getByRole('link').getAttribute('href')!);
    expect(url.pathname).toBe('/app/pdf/document');
  });

  it('keeps a PDF on the legacy path when its annotations did not choose the message API', () => {
    // The flag is on, but the PDF read it as off when its annotations loaded.
    const view = renderThreadBody('pdf', false, false);
    // The message thread is mocked as the copy-link anchor.
    expect(view.queryByRole('link')).toBeNull();
    expect(view.getByText('Comment')).toBeTruthy();
  });

  it('expands a minimized comment in a document detail without a block provider', () => {
    const view = renderThreadBody('md', true);
    expect(view.queryByRole('link')).toBeNull();
    fireEvent.click(view.getByText('1'));
    expect(view.getByRole('link')).toBeTruthy();
  });

  // The popover content, found through the thread it hosts. jsdom never runs
  // the exit animation presence waits on, so closing leaves it mounted and
  // only its open state changes.
  const card = (view: ReturnType<typeof render>) =>
    view.getByText('Copy link').closest('[data-comment-thread]')!
      .parentElement!;

  it('keeps an expanded minimized comment open through a dialog it opens', async () => {
    const view = renderThreadBody('md', true);
    fireEvent.click(view.getByText('1'));
    fireEvent.click(view.getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('button', {
      name: 'Confirm delete',
    });
    // Outside-press detection arms a tick after a layer opens.
    await new Promise((resolve) => setTimeout(resolve));
    // The confirmation is portaled out of the card; pressing it must reach
    // its handler instead of dismissing the card that owns it.
    fireEvent.pointerDown(confirm);
    fireEvent.mouseDown(confirm);
    fireEvent.click(confirm);
    expect(mocks.confirmed).toHaveBeenCalledTimes(1);
    expect(card(view).hasAttribute('data-expanded')).toBe(true);
  });

  it('folds an expanded minimized comment back to its badge once resolved', async () => {
    const [resolved, setResolved] = createSignal(false);
    const view = render(() => (
      <CommentsContext.Provider
        value={{
          documentId: 'document',
          documentType: 'md',
          canComment: () => true,
          isDocumentOwner: () => true,
          highlightedCommentId: () => null,
          setActiveThread: () => {},
          setThreadHeight: () => {},
          getCommentById: () => undefined,
          ownedComment: () => false,
          inComment: true,
          commentOperations: noopCommentOperations,
        }}
      >
        <MinimizedThread
          comment={{ ...comment, resolved: resolved() }}
          layout={{ calculatedYPos: 0 }}
          isActive={false}
        />
      </CommentsContext.Provider>
    ));
    fireEvent.click(view.getByText('1'));
    expect(card(view).hasAttribute('data-expanded')).toBe(true);
    setResolved(true);
    await waitFor(() =>
      expect(card(view).hasAttribute('data-expanded')).toBe(false)
    );
  });

  it('dismisses an expanded minimized comment on a press outside it', async () => {
    const view = renderThreadBody('md', true);
    fireEvent.click(view.getByText('1'));
    expect(view.getByRole('link')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve));
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(card(view).hasAttribute('data-expanded')).toBe(false)
    );
  });

  it.each([
    [true, 'discards a draft as soon as a press outside dismisses it'],
    [false, 'keeps a thread the dismissing press activated'],
  ])('%#: %s', async (isActive) => {
    const setActiveThread = vi.fn();
    const view = render(() => (
      <CommentsContext.Provider
        value={{
          documentId: 'document',
          documentType: 'md',
          canComment: () => true,
          isDocumentOwner: () => true,
          highlightedCommentId: () => null,
          setActiveThread,
          setThreadHeight: () => {},
          getCommentById: () => undefined,
          ownedComment: () => false,
          inComment: true,
          commentOperations: noopCommentOperations,
          messageOperations: { createComment: async () => null },
        }}
      >
        <MinimizedThread
          comment={{ ...comment, isNew: true }}
          layout={{ calculatedYPos: 0 }}
          isActive={isActive}
        />
      </CommentsContext.Provider>
    ));
    await new Promise((resolve) => setTimeout(resolve));
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(
        view.container.ownerDocument
          .querySelector('[data-comment-thread]')!
          .parentElement!.hasAttribute('data-expanded')
      ).toBe(false)
    );
    expect(setActiveThread.mock.calls).toEqual(isActive ? [[null]] : []);
  });

  it.each(['md', 'task', 'snippet', 'skill', 'pdf'] as const)(
    'copies legacy %s root and reply links without a block provider',
    async (documentType) => {
      mocks.unifiedDiscussions = false;
      const view = renderThreadBody(documentType);
      expect(view.getByText('Comment')).toBeTruthy();
      expect(view.getByText('Reply')).toBeTruthy();

      const buttons = view.getAllByRole('button', {
        name: 'Copy comment link',
      });
      for (const [index, id] of ['comment-root', 'reply'].entries()) {
        fireEvent.click(buttons[index]);
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(index + 1));
        const url = new URL(writeText.mock.calls[index][0]);
        expect(url.pathname).toBe(`/app/${documentType}/document`);
        expect(url.searchParams.get(markdownParams.commentId)).toBe(
          documentType === 'pdf' ? null : id
        );
      }
    }
  );
});

describe('resolved discussions', () => {
  const renderThread = (props: { resolved: boolean; isActive: boolean }) => {
    const setActiveThread = vi.fn();
    const view = render(() => (
      <CommentsContext.Provider
        value={{
          documentId: 'document',
          documentType: 'md',
          canComment: () => true,
          isDocumentOwner: () => true,
          highlightedCommentId: () => null,
          setActiveThread,
          setThreadHeight: () => {},
          getCommentById: () => undefined,
          ownedComment: () => false,
          inComment: true,
          commentOperations: noopCommentOperations,
          messageOperations: { createComment: async () => null },
        }}
      >
        <ThreadBody
          comment={{
            ...comment,
            text: 'Fix the\n\nintro',
            replyCount: 2,
            resolved: props.resolved,
          }}
          isActive={props.isActive}
        />
      </CommentsContext.Provider>
    ));
    return { view, setActiveThread };
  };

  it('folds an inactive resolved thread to a one-line summary that opens it', () => {
    const { view, setActiveThread } = renderThread({
      resolved: true,
      isActive: false,
    });
    expect(view.queryByRole('link')).toBeNull();
    expect(view.getByText('Fix the intro')).toBeTruthy();
    expect(view.getByText('2 replies')).toBeTruthy();
    fireEvent.click(
      view.getByRole('button', { name: 'Show resolved comment' })
    );
    expect(setActiveThread).toHaveBeenCalledWith('comment-root');
  });

  it('reopens an active resolved thread', () => {
    const { view } = renderThread({ resolved: true, isActive: true });
    expect(view.getByRole('link')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Reopen' }));
    expect(mocks.patchThread).toHaveBeenCalledWith({
      parent: { type: 'document', id: 'document' },
      rootId: 'comment-root',
      patch: { resolved: false },
    });
  });

  it('resolves an active open thread and releases focus so it folds', () => {
    const { view, setActiveThread } = renderThread({
      resolved: false,
      isActive: true,
    });
    fireEvent.click(view.getByRole('button', { name: 'Resolve' }));
    expect(mocks.patchThread).toHaveBeenCalledWith({
      parent: { type: 'document', id: 'document' },
      rootId: 'comment-root',
      patch: { resolved: true },
    });
    expect(setActiveThread).toHaveBeenCalledWith(null);
  });

  it('offers no resolve action on an inactive open thread', () => {
    const { view } = renderThread({ resolved: false, isActive: false });
    expect(view.queryByRole('button', { name: 'Resolve' })).toBeNull();
  });
});
