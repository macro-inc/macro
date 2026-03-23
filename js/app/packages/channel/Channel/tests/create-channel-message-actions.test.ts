import { describe, expect, it, vi } from 'vitest';
import type { MessageData } from '../../Message';
import { createChannelMessageActions } from '../create-channel-message-actions';

// Mock analytics context
vi.mock('@app/component/analytics-context', () => ({
  useAnalytics: () => ({
    track: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
  }),
}));

type ActionMessage = MessageData & { thread_id?: string | null };

function buildMessage(overrides?: Partial<ActionMessage>): ActionMessage {
  return {
    id: 'message-1',
    content: 'hello world',
    sender_id: 'user-1',
    created_at: '2026-02-25T00:00:00.000Z',
    updated_at: '2026-02-25T00:00:00.000Z',
    deleted_at: null,
    attachments: [],
    reactions: [],
    ...overrides,
  };
}

function buildHarness(input?: {
  userId?: string | undefined;
  channelId?: string;
  onReply?: Parameters<typeof createChannelMessageActions>[0]['onReply'];
  onEdit?: Parameters<typeof createChannelMessageActions>[0]['onEdit'];
  effects?: Parameters<typeof createChannelMessageActions>[0]['effects'];
}) {
  const deleteMessage = vi.fn();
  const addReaction = vi.fn();
  const removeReaction = vi.fn();

  const getMessageActions = createChannelMessageActions({
    channelId: () => input?.channelId ?? 'channel-1',
    userId: () => input?.userId,
    deleteMessage,
    addReaction,
    removeReaction,
    onReply: input?.onReply,
    onEdit: input?.onEdit,
    effects: input?.effects,
  });

  return {
    deleteMessage,
    addReaction,
    removeReaction,
    getMessageActions,
  };
}

describe('createChannelMessageActions', () => {
  it('uses the live message from the reaction context when toggling', () => {
    const harness = buildHarness({ userId: 'user-1' });
    const staleMessage = buildMessage({ reactions: [] });
    const liveMessage = buildMessage({
      reactions: [{ emoji: '👍', users: ['user-1'] }],
    });
    const actions = harness.getMessageActions(staleMessage);

    actions.onReact?.({ message: liveMessage, emoji: '👍' });

    expect(harness.removeReaction).toHaveBeenCalledTimes(1);
    expect(harness.addReaction).not.toHaveBeenCalled();
  });

  it('preserves bound thread context when reacting to a thread reply', () => {
    const harness = buildHarness({ userId: 'user-1' });
    const boundReply = buildMessage({
      id: 'reply-1',
      thread_id: 'parent-1',
      reactions: [],
    });
    const liveReply = buildMessage({
      id: 'reply-1',
      thread_id: undefined,
      reactions: [],
    });
    const actions = harness.getMessageActions(boundReply);

    actions.onReact?.({ message: liveReply, emoji: '👍' });

    expect(harness.addReaction).toHaveBeenCalledTimes(1);
    expect(harness.addReaction).toHaveBeenCalledWith({
      channelId: 'channel-1',
      messageId: 'reply-1',
      emoji: '👍',
      userId: 'user-1',
      threadId: 'parent-1',
      currentReactions: [],
    });
  });
});
