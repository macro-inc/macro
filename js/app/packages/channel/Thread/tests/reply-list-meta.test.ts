import { describe, expect, it } from 'vitest';
import type { ApiThreadReply } from '@service-comms/client';
import { buildThreadReplyListMeta } from '../reply-list-meta';

function createReply(
  id: string,
  createdAt: string,
  senderId = 'user-1'
): ApiThreadReply {
  return {
    id,
    content: '',
    created_at: createdAt,
    updated_at: createdAt,
    sender_id: senderId,
    attachments: [],
    reactions: [],
  };
}

describe('buildThreadReplyListMeta', () => {
  it('builds reply list indices and grouping metadata in order', () => {
    const replies = [
      createReply('r1', '2026-02-20T09:00:00.000Z'),
      createReply('r2', '2026-02-20T09:01:00.000Z'),
      createReply('r3', '2026-02-20T09:02:00.000Z', 'user-2'),
    ];

    const meta = buildThreadReplyListMeta(replies);

    expect(meta.r1).toEqual({
      index: 0,
      isNewMessage: false,
      isFirstNewMessage: false,
      isGroupedWithPrevious: false,
    });
    expect(meta.r2.isGroupedWithPrevious).toBe(true);
    expect(meta.r3.isGroupedWithPrevious).toBe(false);
  });
});
