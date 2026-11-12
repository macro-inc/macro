import type { MessageParent } from '@service-storage/messages';
import { describe, expect, it, vi } from 'vitest';
import type { MessageData } from '../../Message';
import { createChannelMessageActions } from '../create-channel-message-actions';

// Mock analytics context
vi.mock('@app/lib/analytics/analytics-context', () => ({
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
  parentType?: MessageParent['type'];
  canModerate?: boolean;
  onReply?: Parameters<typeof createChannelMessageActions>[0]['onReply'];
  onEdit?: Parameters<typeof createChannelMessageActions>[0]['onEdit'];
  effects?: Parameters<typeof createChannelMessageActions>[0]['effects'];
}) {
  const deleteMessage = vi.fn();
  const removeLinkPreviews = vi.fn();
  const addReaction = vi.fn();
  const removeReaction = vi.fn();

  const getMessageActions = createChannelMessageActions({
    parent: () => ({
      type: input?.parentType ?? 'channel',
      id: (() => input?.channelId ?? 'channel-1')(),
    }),
    userId: () => input?.userId,
    canModerate: () => input?.canModerate ?? false,
    deleteMessage,
    removeLinkPreviews,
    addReaction,
    removeReaction,
    onReply: input?.onReply,
    onEdit: input?.onEdit,
    effects: input?.effects,
  });

  return {
    deleteMessage,
    removeLinkPreviews,
    addReaction,
    removeReaction,
    getMessageActions,
  };
}

describe('createChannelMessageActions', () => {
  it.each([
    ['channel', false, true],
    ['call', false, false],
    ['document', false, false],
    ['document', true, true],
  ] as const)(
    'matches bot deletion permissions for %s (moderator: %s)',
    (parentType, canModerate, canDelete) => {
      const harness = buildHarness({
        userId: 'user-1',
        parentType,
        canModerate,
      });
      const actions = harness.getMessageActions(
        buildMessage({ sender_id: 'bot|agent-1' })
      );

      expect(!!actions.onDelete).toBe(canDelete);
    }
  );

  it('uses the live message from the reaction context when toggling', async () => {
    const harness = buildHarness({ userId: 'user-1' });
    const staleMessage = buildMessage({ reactions: [] });
    const liveMessage = buildMessage({
      reactions: [{ emoji: '👍', users: ['user-1'] }],
    });
    const actions = harness.getMessageActions(staleMessage);

    await actions.onReact?.({ message: liveMessage, emoji: '👍' });

    expect(harness.removeReaction).toHaveBeenCalledTimes(1);
    expect(harness.addReaction).not.toHaveBeenCalled();
  });

  it('preserves bound thread context when reacting to a thread reply', async () => {
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

    await actions.onReact?.({ message: liveReply, emoji: '👍' });

    expect(harness.addReaction).toHaveBeenCalledTimes(1);
    expect(harness.addReaction).toHaveBeenCalledWith({
      parent: { type: 'channel', id: 'channel-1' },
      messageId: 'reply-1',
      emoji: '👍',
      userId: 'user-1',
      threadId: 'parent-1',
      currentReactions: [],
    });
  });

  it('exposes reply action for thread replies', async () => {
    const onReply = vi.fn();
    const harness = buildHarness({ userId: 'user-1', onReply });
    const reply = buildMessage({
      id: 'reply-1',
      thread_id: 'parent-1',
    });
    const actions = harness.getMessageActions(reply);

    await actions.onReply?.({ message: reply });

    expect(onReply).toHaveBeenCalledWith({ message: reply });
  });

  it("lets only the sender remove a message's link previews", () => {
    const sender = buildHarness({ userId: 'user-1' });
    const moderator = buildHarness({ userId: 'user-2', canModerate: true });
    const message = buildMessage({ sender_id: 'user-1' });

    expect(sender.getMessageActions(message).onRemoveLinkPreviews).toBeTypeOf(
      'function'
    );
    expect(
      moderator.getMessageActions(message).onRemoveLinkPreviews
    ).toBeUndefined();
    expect(
      sender.getMessageActions(
        buildMessage({ sender_id: 'user-1', deleted_at: '2026-02-26' })
      ).onRemoveLinkPreviews
    ).toBeUndefined();
  });

  it('removes link previews once the sender confirms, and not when they cancel', async () => {
    const confirmRemoveLinkPreviews = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const harness = buildHarness({
      userId: 'user-1',
      effects: { confirmRemoveLinkPreviews },
    });
    const reply = buildMessage({ id: 'reply-1', thread_id: 'parent-1' });
    const actions = harness.getMessageActions(reply);

    await actions.onRemoveLinkPreviews?.({
      message: reply,
      event: new MouseEvent('click'),
    });
    expect(harness.removeLinkPreviews).not.toHaveBeenCalled();

    await actions.onRemoveLinkPreviews?.({
      message: reply,
      event: new MouseEvent('click'),
    });
    expect(harness.removeLinkPreviews).toHaveBeenCalledExactlyOnceWith({
      parent: { type: 'channel', id: 'channel-1' },
      messageID: 'reply-1',
      threadID: 'parent-1',
    });
  });

  it('removes link previews without asking when Shift is held', async () => {
    const confirmRemoveLinkPreviews = vi.fn();
    const harness = buildHarness({
      userId: 'user-1',
      effects: { confirmRemoveLinkPreviews },
    });
    const message = buildMessage();

    await harness.getMessageActions(message).onRemoveLinkPreviews?.({
      message,
      event: new MouseEvent('click', { shiftKey: true }),
    });

    expect(confirmRemoveLinkPreviews).not.toHaveBeenCalled();
    expect(harness.removeLinkPreviews).toHaveBeenCalledExactlyOnceWith({
      parent: { type: 'channel', id: 'channel-1' },
      messageID: 'message-1',
      threadID: undefined,
    });
  });
});
