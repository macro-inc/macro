import { URL_PARAMS as markdownParams } from '@block-md/constants';
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Root } from './commentType';
import { MinimizedThread } from './MinimizedThreads';
import {
  CommentsContext,
  type CommentsContextType,
  noopCommentOperations,
  ThreadBody,
} from './Thread';

const mocks = vi.hoisted(() => ({ unifiedDiscussions: true }));
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
  }) => <a href={props.buildLink({ id: 'comment-root' })}>Copy link</a>,
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: ParentProps) => props.children,
    StaticMarkdown: (props: { markdown: string }) => <p>{props.markdown}</p>,
  })
);
vi.mock('@ui', () => ({
  Layer: (props: ParentProps) => props.children,
  cn: (...values: string[]) => values.join(' '),
}));
vi.mock('./MeasureContainer', () => ({
  MeasureContainer: (props: ParentProps) => props.children,
}));

const writeText = vi.fn();
beforeEach(() => {
  mocks.unifiedDiscussions = true;
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
  const renderThreadBody = (
    documentType: CommentsContextType['documentType'] = 'md',
    minimized = false
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
          messageOperations: { createComment: async () => null },
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

  it('keeps PDF on the legacy path while its flag-on discussion is deferred', () => {
    const view = renderThreadBody('pdf');
    // The message thread (mocked as the copy-link anchor) is markdown-only.
    expect(view.queryByRole('link')).toBeNull();
    expect(view.getByText('Comment')).toBeTruthy();
  });

  it('expands a minimized comment in a document detail without a block provider', () => {
    const view = renderThreadBody('md', true);
    expect(view.queryByRole('link')).toBeNull();
    fireEvent.click(view.getByText('1'));
    expect(view.getByRole('link')).toBeTruthy();
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
