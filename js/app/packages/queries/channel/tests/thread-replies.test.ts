import type { ApiThreadReply } from '@service-comms/client';
import { describe, expect, it } from 'vitest';
import {
  getThreadReplySnapshot,
  insertThreadReply,
  removeThreadReply,
  replaceThreadReplyId,
  restoreThreadReply,
} from '../thread-replies';

function createReply(
  id: string,
  createdAt = '2024-01-03T01:00:00.000Z',
  overrides: Partial<ApiThreadReply> = {}
): ApiThreadReply {
  return {
    id,
    sender_id: 'user-1',
    content: id,
    created_at: createdAt,
    updated_at: createdAt,
    edited_at: undefined,
    attachments: [],
    reactions: [],
    ...overrides,
  };
}

describe('insertThreadReply', () => {
  it('initializes an empty collection with the inserted reply', () => {
    expect(insertThreadReply(undefined, createReply('reply-1'))).toEqual([
      createReply('reply-1'),
    ]);
  });

  it('appends a new reply and preserves existing order', () => {
    expect(
      insertThreadReply(
        [createReply('reply-1'), createReply('reply-2')],
        createReply('reply-3')
      )
    ).toEqual([
      createReply('reply-1'),
      createReply('reply-2'),
      createReply('reply-3'),
    ]);
  });

  it('returns the same array when the reply already exists', () => {
    const existing = [createReply('reply-1'), createReply('reply-2')];

    expect(insertThreadReply(existing, createReply('reply-2'))).toBe(existing);
  });
});

describe('removeThreadReply', () => {
  it('removes the matching reply', () => {
    expect(
      removeThreadReply([createReply('reply-1'), createReply('reply-2')], 'reply-1')
    ).toEqual([createReply('reply-2')]);
  });

  it('returns the same array when the reply is missing', () => {
    const existing = [createReply('reply-1')];

    expect(removeThreadReply(existing, 'missing')).toBe(existing);
  });
});

describe('replaceThreadReplyId', () => {
  it('replaces an optimistic id and preserves the rest of the reply', () => {
    expect(
      replaceThreadReplyId(
        [createReply('optimistic-reply', '2024-01-03T01:00:00.000Z', { content: 'hello' })],
        'optimistic-reply',
        'real-reply'
      )
    ).toEqual([
      createReply('real-reply', '2024-01-03T01:00:00.000Z', { content: 'hello' }),
    ]);
  });

  it('returns the same array when there is no matching optimistic id', () => {
    const existing = [createReply('reply-1')];

    expect(replaceThreadReplyId(existing, 'missing', 'real-reply')).toBe(existing);
  });
});

describe('getThreadReplySnapshot', () => {
  it('captures the original index and reply for rollback', () => {
    expect(
      getThreadReplySnapshot(
        [createReply('reply-1'), createReply('reply-2')],
        'reply-2'
      )
    ).toEqual({
      replyIndex: 1,
      reply: createReply('reply-2'),
    });
  });

  it('returns undefined when the reply is missing', () => {
    expect(getThreadReplySnapshot([createReply('reply-1')], 'missing')).toBeUndefined();
  });
});

describe('restoreThreadReply', () => {
  it('restores a removed reply at its original index', () => {
    expect(
      restoreThreadReply([createReply('reply-1')], {
        replyIndex: 1,
        reply: createReply('reply-2'),
      })
    ).toEqual([createReply('reply-1'), createReply('reply-2')]);
  });

  it('initializes an empty collection from a snapshot', () => {
    expect(
      restoreThreadReply(undefined, {
        replyIndex: 0,
        reply: createReply('reply-1'),
      })
    ).toEqual([createReply('reply-1')]);
  });

  it('returns the same array when the reply is already present', () => {
    const existing = [createReply('reply-1'), createReply('reply-2')];

    expect(
      restoreThreadReply(existing, {
        replyIndex: 1,
        reply: createReply('reply-2'),
      })
    ).toBe(existing);
  });
});
