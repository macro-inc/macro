import { describe, expect, it, vi } from 'vitest';
import type { MessageData } from '../../Message';
import { createChannelMessageActions } from '../create-channel-message-actions';

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
  effects?: Parameters<typeof createChannelMessageActions>[0]['effects'];
}) {
  const patchMessage = vi.fn();
  const deleteMessage = vi.fn();
  const addReaction = vi.fn();
  const removeReaction = vi.fn();

  const getMessageActions = createChannelMessageActions({
    channelId: () => input?.channelId ?? 'channel-1',
    userId: () => input?.userId,
    patchMessage,
    deleteMessage,
    addReaction,
    removeReaction,
    onReply: input?.onReply,
    effects: input?.effects,
  });

  return {
    patchMessage,
    deleteMessage,
    addReaction,
    removeReaction,
    getMessageActions,
  };
}

describe('createChannelMessageActions', () => {
  it('gates edit/delete to own non-deleted messages', () => {
    const ownHarness = buildHarness({ userId: 'user-1' });
    const ownMessage = buildMessage({ sender_id: 'user-1', deleted_at: null });
    const ownActions = ownHarness.getMessageActions(ownMessage);
    expect(ownActions.onEdit).toBeTypeOf('function');
    expect(ownActions.onDelete).toBeTypeOf('function');

    const otherHarness = buildHarness({ userId: 'user-1' });
    const otherMessage = buildMessage({
      sender_id: 'user-2',
      deleted_at: null,
    });
    const otherActions = otherHarness.getMessageActions(otherMessage);
    expect(otherActions.onEdit).toBeUndefined();
    expect(otherActions.onDelete).toBeUndefined();

    const deletedHarness = buildHarness({ userId: 'user-1' });
    const deletedMessage = buildMessage({
      sender_id: 'user-1',
      deleted_at: '2026-02-25T00:00:00.000Z',
    });
    const deletedActions = deletedHarness.getMessageActions(deletedMessage);
    expect(deletedActions.onEdit).toBeUndefined();
    expect(deletedActions.onDelete).toBeUndefined();
  });

  it('gates reply to top-level non-deleted messages', () => {
    const harness = buildHarness({ userId: 'user-1' });

    const topLevelActions = harness.getMessageActions(
      buildMessage({ deleted_at: null, thread_id: null })
    );
    expect(topLevelActions.onReply).toBeTypeOf('function');

    const threadReplyActions = harness.getMessageActions(
      buildMessage({ deleted_at: null, thread_id: 'parent-message' })
    );
    expect(threadReplyActions.onReply).toBeUndefined();

    const deletedActions = harness.getMessageActions(
      buildMessage({ deleted_at: '2026-02-25T00:00:00.000Z' })
    );
    expect(deletedActions.onReply).toBeUndefined();
  });

  it('toggles reactions and uses default emoji when one is not provided', () => {
    const harness = buildHarness({ userId: 'user-1' });
    const message = buildMessage({
      reactions: [{ emoji: '👍', users: ['user-1'] }],
    });
    const actions = harness.getMessageActions(message);

    actions.onReact?.({ message });
    expect(harness.removeReaction).toHaveBeenCalledTimes(1);
    expect(harness.removeReaction).toHaveBeenCalledWith({
      channelId: 'channel-1',
      messageId: 'message-1',
      emoji: '👍',
      userId: 'user-1',
    });

    actions.onReact?.({ message, emoji: '😂' });
    expect(harness.addReaction).toHaveBeenCalledTimes(1);
    expect(harness.addReaction).toHaveBeenCalledWith({
      channelId: 'channel-1',
      messageId: 'message-1',
      emoji: '😂',
      userId: 'user-1',
    });
  });

  it('keeps react action available without a user id and no-ops on click', () => {
    const harness = buildHarness({ userId: undefined });
    const message = buildMessage();
    const actions = harness.getMessageActions(message);

    expect(actions.onReact).toBeTypeOf('function');
    actions.onReact?.({ message, emoji: '👍' });

    expect(harness.addReaction).not.toHaveBeenCalled();
    expect(harness.removeReaction).not.toHaveBeenCalled();
  });

  it('copies links through injected effects', async () => {
    const copyToClipboard = vi
      .fn<(text: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    const notifyCopyLinkSuccess = vi.fn();
    const notifyCopyLinkFailure = vi.fn();
    const harness = buildHarness({
      userId: 'user-1',
      effects: {
        getLocationHref: () => 'https://example.com/app/component/unified-list',
        copyToClipboard,
        notifyCopyLinkSuccess,
        notifyCopyLinkFailure,
      },
    });

    const actions = harness.getMessageActions(buildMessage());
    await actions.onCopyLink?.({ message: buildMessage() });

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(copyToClipboard.mock.calls[0]?.[0]).toContain(
      'targetMessageId=message-1'
    );
    expect(copyToClipboard.mock.calls[0]?.[0]).toContain('#message-message-1');
    expect(notifyCopyLinkSuccess).toHaveBeenCalledTimes(1);
    expect(notifyCopyLinkFailure).not.toHaveBeenCalled();
  });

  it('edits with trimmed content and rejects empty edits', () => {
    const notifyEmptyEdit = vi.fn();
    const harness = buildHarness({
      userId: 'user-1',
      effects: {
        promptForEdit: () => '  updated content  ',
        notifyEmptyEdit,
      },
    });
    const message = buildMessage({ sender_id: 'user-1' });
    const actions = harness.getMessageActions(message);

    actions.onEdit?.({ message });
    expect(harness.patchMessage).toHaveBeenCalledWith({
      channelID: 'channel-1',
      messageID: 'message-1',
      content: 'updated content',
    });

    const emptyHarness = buildHarness({
      userId: 'user-1',
      effects: {
        promptForEdit: () => '  ',
        notifyEmptyEdit,
      },
    });
    const emptyActions = emptyHarness.getMessageActions(message);
    emptyActions.onEdit?.({ message });
    expect(notifyEmptyEdit).toHaveBeenCalledTimes(1);
    expect(emptyHarness.patchMessage).not.toHaveBeenCalled();
  });
});
