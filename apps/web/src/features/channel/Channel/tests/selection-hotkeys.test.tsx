import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { getActiveCommandByToken } from '@core/hotkey/utils';
import type { Message, MessageListItem } from '@service-storage/messages';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { createThreadHotkeys } from '../../Thread/create-thread-hotkeys';
import { createChannelHotkeys } from '../create-channel-hotkeys';
import { createMessageSelection } from '../create-message-selection';

const timestamp = '2026-09-20T12:00:00Z';
function message(id: string, senderId: string): Message {
  return {
    id,
    sender_id: senderId,
    content: id,
    created_at: timestamp,
    updated_at: timestamp,
    parent: { type: 'channel', id: 'channel' },
    mentions: [],
    attachments: [],
    reactions: [],
  };
}

function rootMessage(id: string, senderId: string): MessageListItem {
  return {
    ...message(id, senderId),
    state: {
      root_id: id,
      user_id: senderId,
      resolved: false,
      created_at: timestamp,
      updated_at: timestamp,
    },
    thread: { preview: [], reply_count: 0 },
  };
}

const own = rootMessage('own', 'alice');
const incoming = rootMessage('incoming', 'bob');
const ownReply = message('own-reply', 'alice');
const incomingReply = message('incoming-reply', 'bob');

function setup(selectedId?: string, selectedReplyId?: string) {
  const onEdit = vi.fn();
  const onDone = vi.fn(() => true);
  render(() => {
    useHotKeyRoot();
    const [attachParent, parentScope] = useHotkeyDOMScope('home');
    registerHotkey({
      scopeId: parentScope,
      hotkey: 'e',
      description: 'Mark done',
      keyDownHandler: onDone,
    });
    const selection = createMessageSelection({
      keys: () => [own.id, incoming.id],
    });
    if (selectedId) selection.select(selectedId);
    const replySelection = createMessageSelection({
      keys: () => [ownReply.id, incomingReply.id],
    });
    if (selectedReplyId) replySelection.select(selectedReplyId);
    const getMessageActions = (item: Pick<Message, 'sender_id'>) =>
      item.sender_id === 'alice' ? { onEdit } : {};
    const channel = createChannelHotkeys({
      selection,
      scrollToMessage: () => false,
      messageById: () =>
        new Map([
          [own.id, own],
          [incoming.id, incoming],
        ]),
      getMessageActions,
      userId: () => 'alice',
      isInputEmpty: () => false,
      isEditing: () => false,
      onOpenFindBar: vi.fn(),
      onGoToBottom: vi.fn(),
    });
    createThreadHotkeys({
      messageListScopeId: channel.messageListScopeId,
      replySelection,
      isThreadFocused: () => !!replySelection.selectedId(),
      isEditing: () => false,
      activeReplies: () => [ownReply, incomingReply],
      threadId: () => own.id,
      getMessageActions,
      userId: () => 'alice',
      parentMessage: () => own,
      collapseThread: vi.fn(),
      isSelected: () => selection.selectedId() === own.id,
      hasReplies: () => true,
      expandThread: vi.fn(),
      isThreadExpanded: () => true,
      setIsReplying: vi.fn(),
    });
    return (
      <div ref={attachGlobalDOMScope}>
        <div ref={attachParent}>
          <div
            ref={channel.attachMessageListRef}
            tabIndex={-1}
            data-testid="messages"
          >
            <div ref={channel.attachInputRef}>
              <input aria-label="Message" />
            </div>
          </div>
        </div>
      </div>
    );
  });
  const list = screen.getByTestId('messages');
  list.focus();
  const pressEdit = () => {
    fireEvent.keyDown(list, { key: 'e' });
    fireEvent.keyUp(list, { key: 'e' });
  };
  return { onEdit, onDone, list, pressEdit };
}

describe('selected message shortcuts in a Home split', () => {
  it('keeps E on an incoming message from marking the parent item done', () => {
    const { pressEdit, onEdit, onDone } = setup(incoming.id);
    expect(
      getActiveCommandByToken(TOKENS.channel.editMessage)?.condition?.()
    ).toBe(false);
    pressEdit();
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('still edits the selected own message', () => {
    const { pressEdit, onEdit, onDone } = setup(own.id);
    pressEdit();
    expect(onEdit).toHaveBeenCalledWith({ message: own });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('allows the parent shortcut when no message is selected', () => {
    const { pressEdit, onEdit, onDone } = setup();
    pressEdit();
    expect(onDone).toHaveBeenCalledOnce();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('keeps E on an incoming reply from editing its own root or marking Home done', () => {
    const { pressEdit, onEdit, onDone } = setup(own.id, incomingReply.id);
    expect(
      getActiveCommandByToken(TOKENS.channel.threadEditReply)?.condition?.()
    ).toBe(false);
    pressEdit();
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('edits the selected own reply instead of its root message', () => {
    const { pressEdit, onEdit, onDone } = setup(own.id, ownReply.id);
    pressEdit();
    expect(onEdit).toHaveBeenCalledExactlyOnceWith({
      message: { ...ownReply, thread_id: own.id },
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('leaves E available for typing in the composer', () => {
    const { onEdit, onDone } = setup(incoming.id);
    const input = screen.getByRole('textbox', { name: 'Message' });
    input.focus();
    expect(fireEvent.keyDown(input, { key: 'e' })).toBe(true);
    fireEvent.keyUp(input, { key: 'e' });
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('releases the shortcut after clearing the selected message', () => {
    const { pressEdit, onDone, list } = setup(incoming.id);
    pressEdit();
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.keyDown(list, { key: 'Escape' });
    fireEvent.keyUp(list, { key: 'Escape' });
    pressEdit();
    expect(onDone).toHaveBeenCalledOnce();
  });
});
