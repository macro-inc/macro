import type { Message, MessageListItem } from '@service-storage/messages';
import { describe, expect, it, vi } from 'vitest';
import { figAnchor, figThread } from './fig-comments';

// These mapping tests do not mount the live comment query/mutation hooks.
vi.mock('@queries/messages/document-messages', () => ({
  useMessageRootsQuery: vi.fn(),
}));
vi.mock('@queries/messages/mutations', () => ({
  newMessageId: vi.fn(),
  usePatchThreadMutation: vi.fn(),
  useSendMessageMutation: vi.fn(),
}));

const parent = { type: 'document' as const, id: 'design' };
const anchor = { type: 'fig', pageId: '0:1', nodeId: '1:10', x: 4, y: 8 };

const message = (id: string, sender: string, content: string): Message => ({
  id,
  parent,
  sender_id: sender,
  content,
  mentions: [],
  attachments: [],
  reactions: [],
  created_at: '2026-10-05T12:00:00.000Z',
  updated_at: '2026-10-05T12:00:00.000Z',
});

const root = (
  overrides: Partial<MessageListItem> = {},
  state: Partial<MessageListItem['state']> = {}
): MessageListItem => ({
  ...message('root', 'u1', 'Check **this**'),
  state: {
    root_id: 'root',
    user_id: 'u1',
    resolved: false,
    anchor: anchor as MessageListItem['state']['anchor'],
    created_at: '',
    updated_at: '',
    ...state,
  },
  thread: { reply_count: 0, preview: [], latest_reply_at: null },
  ...overrides,
});

const name = (id: string) => (id === 'u1' ? 'Alex' : 'Blair');

describe('fig comment threads', () => {
  it('reads only fig pins', () => {
    expect(figAnchor(anchor as MessageListItem['state']['anchor'])).toEqual({
      pageId: '0:1',
      nodeId: '1:10',
      x: 4,
      y: 8,
    });
    expect(figAnchor(null)).toBeNull();
    expect(figThread(root({}, { anchor: null }), name)).toBeUndefined();
  });

  it('summarizes the root and latest replies as plain text', () => {
    const reply = message('r1', 'u2', 'Done');
    const thread = figThread(
      root({
        thread: {
          reply_count: 4,
          preview: [reply, { ...message('r2', 'u2', 'x'), deleted_at: 'now' }],
          latest_reply_at: null,
        },
      }),
      name
    );
    expect(thread?.anchor).toEqual({
      pageId: '0:1',
      nodeId: '1:10',
      x: 4,
      y: 8,
    });
    expect(thread?.replyCount).toBe(4);
    expect(thread?.comments.map((c) => [c.id, c.author.name, c.text])).toEqual([
      ['root', 'Alex', 'Check **this**'],
      ['r1', 'Blair', 'Done'],
    ]);
  });

  it('drops deleted threads, and deleted roots with nothing left', () => {
    expect(figThread(root({}, { deleted_at: 'now' }), name)).toBeUndefined();
    expect(figThread(root({ deleted_at: 'now' }), name)).toBeUndefined();
    const kept = figThread(
      root({
        deleted_at: 'now',
        thread: {
          reply_count: 1,
          preview: [message('r1', 'u2', 'Still here')],
          latest_reply_at: null,
        },
      }),
      name
    );
    expect(kept?.comments.map((c) => c.text)).toEqual(['', 'Still here']);
  });
});
