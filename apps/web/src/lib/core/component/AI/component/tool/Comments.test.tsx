import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Component, JSX, ParentProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import {
  commentHandler,
  commentOnTextHandler,
  deleteCommentHandler,
  readDiscussionHandler,
} from './Comments';

vi.mock('@core/component/ItemPreview', () => ({
  ItemPreview: (props: { id: string; type: string }) => (
    <span data-item-type={props.type}>{props.id}</span>
  ),
}));
vi.mock('@ui', () => ({
  Layer: (props: ParentProps) => props.children,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      type="button"
      onClick={props.onClick}
      aria-expanded={props['aria-expanded']}
    >
      {props.children}
    </button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const initiativeId = '01992d2f-8444-7000-8000-000000000001';
const documentId = '01992d2f-8444-7000-8000-000000000002';
const companyId = '01992d2f-8444-7000-8000-000000000003';
const threadId = '01992d2f-8444-7000-8000-000000000007';
const commentId = '01992d2f-8444-7000-8000-000000000008';

const handlers = {
  Comment: commentHandler,
  CommentOnText: commentOnTextHandler,
  DeleteComment: deleteCommentHandler,
  ReadDiscussion: readDiscussionHandler,
};

function tool(name: keyof typeof handlers, data: unknown, response?: unknown) {
  return render(() => (
    <Dynamic
      component={handlers[name].render as Component<Record<string, unknown>>}
      tool={{ name, data }}
      response={response === undefined ? undefined : { name, data: response }}
      renderContext={{
        isStreaming: response === undefined,
        grouped: false,
        followedBy: () => false,
      }}
    />
  ));
}

it('names the item a reply landed on once the response carries it', () => {
  tool('Comment', { threadId, content: 'Done.' });
  expect(
    screen.getByText('Reply to a comment on a comment thread')
  ).toBeTruthy();
  cleanup();

  tool(
    'Comment',
    { threadId, content: 'Done.' },
    { entityType: 'initiative', entityId: initiativeId, threadId, commentId }
  );
  expect(screen.getByText('Replied to a comment on')).toBeTruthy();
  expect(screen.getByText(initiativeId).getAttribute('data-item-type')).toBe(
    'initiative'
  );
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText('Done.')).toBeTruthy();
});

it('shows a new comment on the item it was addressed to', () => {
  tool('Comment', {
    entityType: 'crm_company',
    entityId: companyId,
    content: 'Renewal is due.',
  });
  expect(screen.getByText('Comment on')).toBeTruthy();
  expect(screen.getByText(companyId).getAttribute('data-item-type')).toBe(
    'crm_company'
  );
});

it('keeps the quoted passage with an inline comment', () => {
  tool(
    'CommentOnText',
    { documentId, quote: 'ships on Friday', content: 'Still right?' },
    { documentId, threadId, commentId: threadId, markedText: 'ships on Friday' }
  );
  expect(screen.getByText('Commented on text in')).toBeTruthy();
  expect(screen.getByText(documentId).getAttribute('data-item-type')).toBe(
    'document'
  );
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText('ships on Friday')).toBeTruthy();
  expect(screen.getByText('Still right?')).toBeTruthy();
});

it('lists every thread of a discussion with its comments', () => {
  tool('ReadDiscussion', { entityType: 'crm_company', entityId: companyId });
  expect(screen.queryByRole('button')).toBeNull();
  cleanup();

  tool(
    'ReadDiscussion',
    { entityType: 'crm_company', entityId: companyId },
    {
      entityType: 'crm_company',
      entityId: companyId,
      threads: [
        {
          id: threadId,
          resolved: true,
          comments: [
            {
              id: threadId,
              author: 'macro|author@example.com',
              content: 'First comment',
              createdAt: '2026-10-21T12:00:00Z',
            },
            {
              id: commentId,
              author: 'macro|author@example.com',
              createdAt: '2026-10-21T12:05:00Z',
            },
          ],
        },
      ],
    }
  );
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText('First comment')).toBeTruthy();
  expect(screen.getByText('Deleted comment')).toBeTruthy();
  expect(screen.getByText('Resolved')).toBeTruthy();
});

it('says when a whole thread was deleted', () => {
  tool(
    'DeleteComment',
    { commentId: threadId },
    {
      entityType: 'document',
      entityId: documentId,
      commentId: threadId,
      deletedThread: true,
    }
  );
  expect(screen.getByText(/Deleted a comment thread on/)).toBeTruthy();
  expect(screen.getByText(documentId).getAttribute('data-item-type')).toBe(
    'document'
  );
});
