import { URL_PARAMS as markdownParams } from '@block-md/constants';
import { URL_PARAMS as pdfParams } from '@block-pdf/constants';
import { cleanup, render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Root } from './commentType';
import { MinimizedThread } from './MinimizedThreads';
import { CommentsContext, ThreadBody } from './Thread';

const mocks = vi.hoisted(() => ({ blockName: 'md' }));
vi.mock('@core/block', () => ({
  useBlockAliasedName: () => mocks.blockName,
}));
vi.mock('@channel/Input', () => ({ ChannelInput: () => null }));
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
vi.mock('@core/util/webOrigin', () => ({
  getWebOrigin: () => 'https://macro.test',
}));
vi.mock('@ui', () => ({
  Layer: (props: ParentProps) => props.children,
  cn: (...values: string[]) => values.join(' '),
}));
vi.mock('./MeasureContainer', () => ({
  MeasureContainer: (props: ParentProps) => props.children,
}));

afterEach(cleanup);

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
  it.each(['md', 'pdf', 'task'])(
    'uses the parameter read by document navigation for %s',
    (blockName) => {
      mocks.blockName = blockName;
      const view = render(() => (
        <CommentsContext.Provider
          value={{
            documentId: 'document',
            canComment: () => true,
            isDocumentOwner: () => true,
            highlightedCommentId: () => null,
            setActiveThread: () => {},
            setThreadHeight: () => {},
            commentOperations: {
              createComment: async () => null,
            },
          }}
        >
          <ThreadBody comment={comment} isActive />
        </CommentsContext.Provider>
      ));
      const url = new URL(view.getByRole('link').getAttribute('href')!);
      expect(url.pathname).toBe(`/app/${blockName}/document`);
      expect(url.searchParams.get(markdownParams.commentId)).toBe(
        'comment-root'
      );
      expect(url.searchParams.get(pdfParams.commentId)).toBe('comment-root');
      expect(url.searchParams.has('commentId')).toBe(false);
    }
  );
});
