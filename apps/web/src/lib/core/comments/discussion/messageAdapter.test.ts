import { expect, it } from 'vitest';
import { discussionCommentToMessageData } from './messageAdapter';
import type { DiscussionComment } from './types';

const comment: DiscussionComment = {
  id: 'comment-1',
  threadId: 'thread-1',
  authorId: 'user-1',
  text: 'hello',
  createdAt: '2026-02-25T00:00:00.000Z',
  updatedAt: '2026-02-25T00:00:00.000Z',
  deletedAt: null,
};

it('exposes the discussion thread id so Reply can find the composer', () => {
  expect(discussionCommentToMessageData(comment)).toMatchObject({
    id: 'comment-1',
    thread_id: 'thread-1',
    content: 'hello',
    sender_id: 'user-1',
  });
});
