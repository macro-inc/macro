import { URL_PARAMS as markdownParams } from '@block-md/constants';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Root } from './commentType';
import { MinimizedThread } from './MinimizedThreads';
import {
  CommentsContext,
  type CommentsContextType,
  ThreadBody,
} from './Thread';

vi.mock('@core/util/url', () => ({
  buildSimpleEntityUrl: (
    entity: { type: string; id: string },
    params: Record<string, string>
  ) =>
    `https://macro.test/app/${entity.type}/${entity.id}?${new URLSearchParams(params)}`,
}));
vi.mock('@channel/Input', () => ({ ChannelInput: () => null }));
vi.mock('@queries/contacts/contacts', () => ({ useContacts: () => () => [] }));
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
  })
);
vi.mock('@ui', () => ({
  Layer: (props: ParentProps) => props.children,
  cn: (...values: string[]) => values.join(' '),
}));
vi.mock('./MeasureContainer', () => ({
  MeasureContainer: (props: ParentProps) => props.children,
}));

afterEach(() => {
  cleanup();
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

describe('anchored comment threads', () => {
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
          commentOperations: { createComment: async () => null },
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

  it.each(['md', 'task', 'snippet', 'skill', 'pdf'] as const)(
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

  it('expands a minimized comment in a document detail without a block provider', () => {
    const view = renderThreadBody('md', true);
    expect(view.queryByRole('link')).toBeNull();
    fireEvent.click(view.getByText('1'));
    expect(view.getByRole('link')).toBeTruthy();
  });
});
