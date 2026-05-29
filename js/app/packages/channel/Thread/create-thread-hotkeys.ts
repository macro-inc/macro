import {
  createHotkeyGroup,
  registerHotkey,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { HOTKEY_PRIORITY_HIGH } from '@core/hotkey/types';
import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import type { ApiThreadReply } from '@service-storage/generated/schemas/apiThreadReply';
import { type Accessor, onCleanup } from 'solid-js';
import type { MessageSelection } from '../Channel/create-message-selection';
import type { MessageActions, MessageData } from '../Message';
import { scrollMessageIntoView } from '../scroll-utils';

type CreateThreadHotkeysOptions = {
  messageListScopeId: string;
  replySelection: MessageSelection;
  isThreadFocused: Accessor<boolean>;
  isEditing: Accessor<boolean>;
  activeReplies: Accessor<Array<ApiThreadReply>>;
  threadId: Accessor<string>;
  getMessageActions: (message: MessageData) => MessageActions | undefined;
  userId: Accessor<string | undefined>;
  parentMessage: Accessor<ApiChannelMessage>;
  collapseThread: () => void;
  isSelected: Accessor<boolean>;
  hasReplies: Accessor<boolean>;
  expandThread: () => void;
  isThreadExpanded: Accessor<boolean>;
  setIsReplying: (replying: boolean) => void;
};

export function canReplyToThreadFromHotkey(input: {
  isThreadFocused: boolean;
  isEditing: boolean;
}) {
  return input.isThreadFocused && !input.isEditing;
}

export function canEditOrDeleteThreadReplyFromHotkey(input: {
  isThreadFocused: boolean;
  isEditing: boolean;
  hasSelectedReply: boolean;
  isOwnReply: boolean;
}) {
  return (
    canReplyToThreadFromHotkey(input) &&
    input.hasSelectedReply &&
    input.isOwnReply
  );
}

export function createThreadHotkeys(options: CreateThreadHotkeysOptions) {
  const scope = options.messageListScopeId;
  const group = createHotkeyGroup();

  const getReplyById = (id: string): MessageData | undefined => {
    const reply = options.activeReplies().find((r) => r.id === id);
    if (!reply) return undefined;
    return { ...reply, thread_id: options.threadId() } as MessageData;
  };

  registerHotkey({
    scopeId: scope,
    hotkey: 'arrowright',
    hotkeyToken: TOKENS.channel.expandThread,
    description: 'Enter thread',
    registrationType: 'add',
    handlerPriority: HOTKEY_PRIORITY_HIGH,
    condition: () => options.isSelected() && options.hasReplies(),
    keyDownHandler: () => {
      options.expandThread();
      const id = options.replySelection.selectFirst();
      if (id) {
        requestAnimationFrame(() => scrollMessageIntoView(id));
      }
      return true;
    },
  }).withGroup(group);

  registerHotkey({
    scopeId: scope,
    hotkey: 'arrowup',
    hotkeyToken: TOKENS.channel.threadPreviousReply,
    description: 'Previous reply',
    registrationType: 'add',
    handlerPriority: HOTKEY_PRIORITY_HIGH,
    condition: () => options.isThreadFocused() && options.isThreadExpanded(),
    keyDownHandler: () => {
      const before = options.replySelection.selectedId();
      const id = options.replySelection.selectPrevious();
      if (id && id !== before) {
        scrollMessageIntoView(id);
      } else {
        options.replySelection.clear();
      }
      return true;
    },
  }).withGroup(group);

  registerHotkey({
    scopeId: scope,
    hotkey: 'arrowdown',
    hotkeyToken: TOKENS.channel.threadNextReply,
    description: 'Next reply',
    registrationType: 'add',
    handlerPriority: HOTKEY_PRIORITY_HIGH,
    condition: () => options.isThreadFocused() && options.isThreadExpanded(),
    keyDownHandler: () => {
      const id = options.replySelection.selectNext();
      if (id) {
        scrollMessageIntoView(id);
        return true;
      }
      options.replySelection.clear();
      return false;
    },
  }).withGroup(group);

  registerHotkey({
    scopeId: scope,
    hotkey: 'arrowleft',
    hotkeyToken: TOKENS.channel.threadCollapse,
    description: 'Collapse thread',
    registrationType: 'add',
    handlerPriority: HOTKEY_PRIORITY_HIGH,
    condition: () => options.isThreadFocused() && options.isThreadExpanded(),
    keyDownHandler: () => {
      options.collapseThread();
      options.replySelection.clear();
      return true;
    },
  }).withGroup(group);

  registerHotkey({
    scopeId: scope,
    hotkey: 'escape',
    hotkeyToken: TOKENS.channel.threadExit,
    description: 'Exit thread',
    registrationType: 'add',
    handlerPriority: HOTKEY_PRIORITY_HIGH,
    condition: options.isThreadFocused,
    keyDownHandler: () => {
      options.replySelection.clear();
      return true;
    },
  }).withGroup(group);

  registerHotkey({
    scopeId: scope,
    hotkey: 'enter',
    hotkeyToken: TOKENS.channel.threadReply,
    description: 'Reply to thread',
    registrationType: 'add',
    handlerPriority: HOTKEY_PRIORITY_HIGH,
    condition: () =>
      canReplyToThreadFromHotkey({
        isThreadFocused: options.isThreadFocused(),
        isEditing: options.isEditing(),
      }),
    keyDownHandler: () => {
      const parentMsg = options.parentMessage();
      const actions = options.getMessageActions(parentMsg);
      actions?.onReply?.({ message: parentMsg });
      return true;
    },
  }).withGroup(group);

  registerHotkey({
    scopeId: scope,
    hotkey: 'e',
    hotkeyToken: TOKENS.channel.threadEditReply,
    description: 'Edit reply',
    registrationType: 'add',
    handlerPriority: HOTKEY_PRIORITY_HIGH,
    condition: () => {
      if (options.isEditing()) return false;
      const replyId = options.replySelection.selectedId();
      if (!replyId) return false;
      const reply = getReplyById(replyId);
      return canEditOrDeleteThreadReplyFromHotkey({
        isThreadFocused: options.isThreadFocused(),
        isEditing: options.isEditing(),
        hasSelectedReply: !!replyId,
        isOwnReply: !!reply && reply.sender_id === options.userId(),
      });
    },
    keyDownHandler: () => {
      const replyId = options.replySelection.selectedId();
      if (!replyId) return false;
      const reply = getReplyById(replyId);
      if (!reply) return false;
      const actions = options.getMessageActions(reply);
      actions?.onEdit?.({ message: reply });
      return true;
    },
  }).withGroup(group);

  registerHotkey({
    scopeId: scope,
    hotkey: 'backspace',
    hotkeyToken: TOKENS.channel.threadDeleteReply,
    description: 'Delete reply',
    registrationType: 'add',
    handlerPriority: HOTKEY_PRIORITY_HIGH,
    condition: () => {
      if (options.isEditing()) return false;
      const replyId = options.replySelection.selectedId();
      if (!replyId) return false;
      const reply = getReplyById(replyId);
      return canEditOrDeleteThreadReplyFromHotkey({
        isThreadFocused: options.isThreadFocused(),
        isEditing: options.isEditing(),
        hasSelectedReply: !!replyId,
        isOwnReply: !!reply && reply.sender_id === options.userId(),
      });
    },
    keyDownHandler: () => {
      const replyId = options.replySelection.selectedId();
      if (!replyId) return false;
      const reply = getReplyById(replyId);
      if (!reply) return false;
      const actions = options.getMessageActions(reply);
      actions?.onDelete?.({ message: reply });
      return true;
    },
  }).withGroup(group);

  const [attachReplyInputRef, replyInputScope] = useHotkeyDOMScope(
    'channel-reply-input'
  );

  registerHotkey({
    scopeId: replyInputScope,
    hotkey: 'escape',
    hotkeyToken: TOKENS.channel.cancelReply,
    description: 'Cancel reply',
    runWithInputFocused: true,
    keyDownHandler: () => {
      options.setIsReplying(false);
      return true;
    },
  }).withGroup(group);

  onCleanup(() => group.dispose());

  return { attachReplyInputRef };
}
