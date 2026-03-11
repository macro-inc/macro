import type { ApiThreadReply } from '@service-comms/client';
import { describe, expect, it } from 'vitest';
import {
  captureThreadPreviewReplySnapshot,
  insertReplyIntoThreadPreview,
  removeReplyFromThreadPreview,
  restoreReplyToThreadPreview,
  type ThreadPreviewReplySnapshot,
  type ThreadPreviewState,
} from '../thread-preview';

function createReply(
  id: string,
  createdAt: string,
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

function createThreadPreview(
  overrides: Partial<ThreadPreviewState> = {}
): ThreadPreviewState {
  return {
    preview: [],
    reply_count: 0,
    latest_reply_at: null,
    ...overrides,
  };
}

describe('insertReplyIntoThreadPreview', () => {
  it('appends a reply, increments the count, and updates latest_reply_at', () => {
    const reply = createReply('reply-2', '2024-01-03T02:00:00.000Z');

    expect(
      insertReplyIntoThreadPreview(
        createThreadPreview({
          preview: [createReply('reply-1', '2024-01-03T01:00:00.000Z')],
          reply_count: 1,
          latest_reply_at: '2024-01-03T01:00:00.000Z',
        }),
        reply
      )
    ).toEqual({
      preview: [createReply('reply-1', '2024-01-03T01:00:00.000Z'), reply],
      reply_count: 2,
      latest_reply_at: '2024-01-03T02:00:00.000Z',
    });
  });
});

describe('removeReplyFromThreadPreview', () => {
  it('removes a preview reply, decrements the count, and recalculates latest_reply_at', () => {
    expect(
      removeReplyFromThreadPreview(
        createThreadPreview({
          preview: [
            createReply('reply-1', '2024-01-03T01:00:00.000Z'),
            createReply('reply-2', '2024-01-03T02:00:00.000Z'),
          ],
          reply_count: 2,
          latest_reply_at: '2024-01-03T02:00:00.000Z',
        }),
        'reply-2'
      )
    ).toEqual({
      preview: [createReply('reply-1', '2024-01-03T01:00:00.000Z')],
      reply_count: 1,
      latest_reply_at: '2024-01-03T01:00:00.000Z',
    });
  });

  it('decrements reply_count even when the reply is not in preview but count is non-zero', () => {
    expect(
      removeReplyFromThreadPreview(
        createThreadPreview({
          preview: [createReply('reply-1', '2024-01-03T01:00:00.000Z')],
          reply_count: 2,
          latest_reply_at: '2024-01-03T02:00:00.000Z',
        }),
        'reply-2'
      )
    ).toEqual({
      preview: [createReply('reply-1', '2024-01-03T01:00:00.000Z')],
      reply_count: 1,
      latest_reply_at: '2024-01-03T02:00:00.000Z',
    });
  });
});

describe('captureThreadPreviewReplySnapshot', () => {
  it('captures the original preview index and reply', () => {
    expect(
      captureThreadPreviewReplySnapshot(
        createThreadPreview({
          preview: [
            createReply('reply-1', '2024-01-03T01:00:00.000Z'),
            createReply('reply-2', '2024-01-03T02:00:00.000Z'),
          ],
          reply_count: 2,
          latest_reply_at: '2024-01-03T02:00:00.000Z',
        }),
        'reply-2'
      )
    ).toEqual<ThreadPreviewReplySnapshot>({
      previewIndex: 1,
      reply: createReply('reply-2', '2024-01-03T02:00:00.000Z'),
    });
  });
});

describe('restoreReplyToThreadPreview', () => {
  it('restores a removed preview reply in place and updates thread metadata', () => {
    expect(
      restoreReplyToThreadPreview(
        createThreadPreview({
          preview: [createReply('reply-1', '2024-01-03T01:00:00.000Z')],
          reply_count: 1,
          latest_reply_at: '2024-01-03T01:00:00.000Z',
        }),
        {
          previewIndex: 1,
          reply: createReply('reply-2', '2024-01-03T02:00:00.000Z'),
        },
        '2024-01-03T02:00:00.000Z'
      )
    ).toEqual({
      preview: [
        createReply('reply-1', '2024-01-03T01:00:00.000Z'),
        createReply('reply-2', '2024-01-03T02:00:00.000Z'),
      ],
      reply_count: 2,
      latest_reply_at: '2024-01-03T02:00:00.000Z',
    });
  });

  it('increments reply_count even when only created_at is available', () => {
    expect(
      restoreReplyToThreadPreview(
        createThreadPreview({
          preview: [],
          reply_count: 0,
          latest_reply_at: null,
        }),
        undefined,
        '2024-01-03T02:00:00.000Z'
      )
    ).toEqual({
      preview: [],
      reply_count: 1,
      latest_reply_at: '2024-01-03T02:00:00.000Z',
    });
  });
});
