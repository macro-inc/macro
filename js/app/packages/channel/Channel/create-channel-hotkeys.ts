import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import type { Accessor } from 'solid-js';
import { useSubscribeToKeypress } from '@app/signal/hotkeyRoot';
import type { ThreadListNavigation } from './ThreadList';
import type { MessageSelection } from './create-message-selection';
import type { ApiChannelMessage } from '@service-comms/client';
import type { MessageActions, MessageData } from '../Message';

type CreateChannelHotkeysOptions = {
  selection: MessageSelection;
  navigation: Accessor<ThreadListNavigation | undefined>;
  messageById: Accessor<Map<string, ApiChannelMessage>>;
  getMessageActions: (message: MessageData) => MessageActions | undefined;
  userId: Accessor<string | undefined>;
  isInputEmpty: Accessor<boolean>;
  isEditing: Accessor<boolean>;
};

export function canReplyToSelectedMessageFromHotkey(input: {
  hasSelection: boolean;
  isEditing: boolean;
}) {
  return input.hasSelection && !input.isEditing;
}

export function canEditOrDeleteSelectedMessageFromHotkey(input: {
  hasSelection: boolean;
  isEditing: boolean;
  isOwnMessage: boolean;
}) {
  return canReplyToSelectedMessageFromHotkey(input) && input.isOwnMessage;
}

export function createChannelHotkeys(options: CreateChannelHotkeysOptions) {
  const [attachMessageList, messageListScope] =
    useHotkeyDOMScope('channel-messages');
  const [attachInput, inputScope] = useHotkeyDOMScope('channel-input');

  let messageListEl: HTMLElement | undefined;
  let inputEl: HTMLElement | undefined;

  useSubscribeToKeypress(() => {
    if (messageListEl && messageListEl.dataset.channelNav !== 'keyboard') {
      messageListEl.dataset.channelNav = 'keyboard';
    }
  });

  const hasSelection = () => !!options.selection.selectedId();
  const canRunSelectionActionHotkeys = () =>
    canReplyToSelectedMessageFromHotkey({
      hasSelection: hasSelection(),
      isEditing: options.isEditing(),
    });

  const getSelectedMessage = () => {
    const id = options.selection.selectedId();
    if (!id) return undefined;
    return options.messageById().get(id);
  };

  registerHotkey({
    scopeId: messageListScope,
    hotkey: 'arrowup',
    hotkeyToken: TOKENS.channel.focusPreviousMessage,
    description: 'Previous message',
    keyDownHandler: () => {
      const id = options.selection.selectPrevious();
      if (id) {
        options.navigation()?.markUserIntent('up');
        options.navigation()?.scrollToId(id, { align: 'nearest' });
      }
      return true;
    },
  });

  registerHotkey({
    scopeId: messageListScope,
    hotkey: 'arrowdown',
    hotkeyToken: TOKENS.channel.focusNextMessage,
    description: 'Next message',
    keyDownHandler: () => {
      const id = options.selection.selectNext();
      if (id) {
        options.navigation()?.markUserIntent('down');
        options.navigation()?.scrollToId(id, { align: 'nearest' });
      } else {
        inputEl?.querySelector<HTMLElement>('[contenteditable]')?.focus();
      }
      return true;
    },
  });

  registerHotkey({
    scopeId: messageListScope,
    hotkey: 'shift+g',
    description: 'Go to latest message',
    keyDownHandler: () => {
      options.selection.clear();
      const id = options.selection.selectPrevious();
      if (!id) return false;
      options.navigation()?.markUserIntent('down');
      options.navigation()?.scrollToId(id, { align: 'end' });
      return true;
    },
  });

  registerHotkey({
    scopeId: messageListScope,
    hotkey: 'enter',
    hotkeyToken: TOKENS.channel.replyToMessage,
    description: 'Reply to message',
    condition: canRunSelectionActionHotkeys,
    keyDownHandler: () => {
      const msg = getSelectedMessage();
      if (!msg) return false;
      const actions = options.getMessageActions(msg);
      actions?.onReply?.({ message: msg });
      return true;
    },
  });

  registerHotkey({
    scopeId: messageListScope,
    hotkey: 'e',
    hotkeyToken: TOKENS.channel.editMessage,
    description: 'Edit message',
    condition: () => {
      if (!canRunSelectionActionHotkeys()) return false;
      const msg = getSelectedMessage();
      return canEditOrDeleteSelectedMessageFromHotkey({
        hasSelection: true,
        isEditing: options.isEditing(),
        isOwnMessage: !!msg && msg.sender_id === options.userId(),
      });
    },
    keyDownHandler: () => {
      const msg = getSelectedMessage();
      if (!msg) return false;
      const actions = options.getMessageActions(msg);
      actions?.onEdit?.({ message: msg });
      return true;
    },
  });

  registerHotkey({
    scopeId: messageListScope,
    hotkey: 'backspace',
    hotkeyToken: TOKENS.channel.deleteMessage,
    description: 'Delete message',
    condition: () => {
      if (!canRunSelectionActionHotkeys()) return false;
      const msg = getSelectedMessage();
      return canEditOrDeleteSelectedMessageFromHotkey({
        hasSelection: true,
        isEditing: options.isEditing(),
        isOwnMessage: !!msg && msg.sender_id === options.userId(),
      });
    },
    keyDownHandler: () => {
      const msg = getSelectedMessage();
      if (!msg) return false;
      const actions = options.getMessageActions(msg);
      actions?.onDelete?.({ message: msg });
      return true;
    },
  });

  registerHotkey({
    scopeId: messageListScope,
    hotkey: 'escape',
    hotkeyToken: TOKENS.channel.clearSelection,
    description: 'Clear selection',
    condition: hasSelection,
    keyDownHandler: () => {
      options.selection.clear();
      return true;
    },
  });

  registerHotkey({
    scopeId: inputScope,
    hotkey: 'arrowup',
    hotkeyToken: TOKENS.channel.focusPreviousMessage,
    description: 'Select last message',
    runWithInputFocused: true,
    condition: options.isInputEmpty,
    keyDownHandler: () => {
      const id = options.selection.selectPrevious();
      if (id) {
        options.navigation()?.markUserIntent('up');
        options.navigation()?.scrollToId(id, { align: 'nearest' });
        messageListEl?.focus();
      }
      return true;
    },
  });

  return {
    messageListScopeId: messageListScope,
    attachMessageListRef: (el: HTMLElement) => {
      messageListEl = el;
      attachMessageList(el);
    },
    attachInputRef: (el: HTMLElement) => {
      inputEl = el;
      attachInput(el);
    },
  };
}
