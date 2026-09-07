import type { MessageParent, MessageThread } from '@service-storage/messages';
import { createRoot } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { createMessageDiscussionSource } from './messages-discussion';

const mocks = vi.hoisted(() => ({
  references: {
    isSuccess: true,
    isPending: false,
    isError: false,
    data: [] as unknown[],
    refetch: vi.fn(),
  },
  writes: vi.fn(),
}));
vi.mock('./messages', () => ({
  useMessageThreadsQuery: () => ({
    isSuccess: true,
    isPending: false,
    isError: false,
    data: [],
  }),
  useChannelReferenceThreadsQuery: () => mocks.references,
  useMessageTyping: () => () => [],
  useMessageLink: () => () => null,
  messageActions: (parent: () => MessageParent) =>
    Object.fromEntries(
      ['post', 'edit', 'delete', 'react', 'resolve', 'deleteThread'].map(
        (action) => [
          action,
          (...args: unknown[]) => mocks.writes(parent(), action, ...args),
        ]
      )
    ),
}));
vi.mock('@service-storage/messages', () => ({
  entityMessagesClient: { typing: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@channel/Thread/utils/message-actions', () => ({
  buildMessageLink: (channel: string, message: string) =>
    `/channel/${channel}/${message}`,
}));

const channel: MessageParent = { type: 'channel', id: 'source-channel' };
const document: MessageParent = { type: 'document', id: 'document' };
const thread: MessageThread = {
  state: {
    root_id: 'root',
    user_id: 'macro|author@example.com',
    resolved: false,
    anchor: null,
    created_at: '2026-09-06',
    updated_at: '2026-09-06',
    deleted_at: null,
  },
  root: {
    id: 'root',
    parent: channel,
    thread_id: null,
    sender_id: 'macro|author@example.com',
    content: 'Referenced discussion',
    mentions: [],
    attachments: [],
    reactions: [],
    created_at: '2026-09-06',
    updated_at: '2026-09-06',
    edited_at: null,
    deleted_at: null,
    triggered_by: null,
    bot_profile: null,
    imported_author: null,
  },
  replies: [],
};
beforeEach(() => {
  mocks.writes.mockReset();
  mocks.references.data = [{ channel_name: 'Source', can_reply: true, thread }];
});

it('keeps channel replies and mutations at their canonical parent while new roots stay on the document', async () => {
  let dispose!: () => void;
  const source = createRoot((cleanup) => {
    dispose = cleanup;
    return createMessageDiscussionSource({
      parent: () => document,
      canEdit: () => true,
      currentUserId: () => 'macro|author@example.com',
    });
  });
  try {
    expect(source.threads()).toEqual([]);
    source.channelReferences?.setEnabled(true);
    const sourceThread = source.threads()[0];
    expect(sourceThread.sourceLabel).toBe('Source');
    expect(source.canReply?.(sourceThread)).toBe(true);
    expect(source.canDeleteThread?.(sourceThread)).toBe(false);
    await source.createReply('root', 'reply', [], []);
    expect(mocks.writes).toHaveBeenLastCalledWith(
      channel,
      'post',
      expect.objectContaining({ thread_id: 'root', content: 'reply' })
    );
    await source.editComment(sourceThread.comments[0], 'edit', [], []);
    expect(mocks.writes).toHaveBeenLastCalledWith(
      channel,
      'edit',
      'root',
      expect.objectContaining({ content: 'edit' })
    );
    await source.deleteComment(sourceThread.comments[0]);
    expect(mocks.writes).toHaveBeenLastCalledWith(channel, 'delete', 'root');
    expect(source.buildCommentLink?.(sourceThread.comments[0])).toBe(
      '/channel/source-channel/root'
    );
    await source.createThread('new discussion', [], []);
    expect(mocks.writes).toHaveBeenLastCalledWith(
      document,
      'post',
      expect.objectContaining({ content: 'new discussion' })
    );
  } finally {
    dispose();
  }
});

it('shows a readable source without enabling replies when its write capability is absent', () => {
  mocks.references.data = [
    { channel_name: 'Read only', can_reply: false, thread },
  ];
  createRoot((dispose) => {
    const source = createMessageDiscussionSource({
      parent: () => document,
      canEdit: () => true,
      currentUserId: () => 'macro|author@example.com',
    });
    source.channelReferences?.setEnabled(true);
    expect(source.canReply?.(source.threads()[0])).toBe(false);
    dispose();
  });
});
