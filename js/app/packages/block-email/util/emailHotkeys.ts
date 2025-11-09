import { TOKENS } from '@core/hotkey/tokens';
import type { Thread } from '@service-email/generated/schemas';
import { registerHotkey } from 'core/hotkey/hotkeys';
import type { Accessor } from 'solid-js';

export interface EmailHotkeyHandlers {
  archiveThread: () => boolean;
  navigateToPreviousMessage: () => boolean;
  navigateToNextMessage: () => boolean;
}

export function registerEmailHotkeys(
  scopeId: string,
  threadData: Accessor<Thread | undefined>,
  handlers: EmailHotkeyHandlers
) {
  registerHotkey({
    hotkey: 'e',
    scopeId: scopeId,
    description: threadData()?.inbox_visible
      ? 'Unarchive thread'
      : 'Archive thread',
    keyDownHandler: handlers.archiveThread,
    hotkeyToken: TOKENS.email.archive,
    displayPriority: 10,
  });
  registerHotkey({
    hotkey: 'opt+r',
    scopeId: scopeId,
    description: 'Reply to thread',
    keyDownHandler: () => {
      // handlers.setReplyMode('reply');
      return true;
    },
    hotkeyToken: TOKENS.email.reply,
    displayPriority: 9,
  });
  registerHotkey({
    hotkey: 'r',
    scopeId: scopeId,
    description: 'Reply all to thread',
    keyDownHandler: () => {
      // handlers.setReplyMode('reply-all');
      return true;
    },
    hotkeyToken: TOKENS.email.replyAll,
    displayPriority: 8,
  });
  registerHotkey({
    hotkey: 'f',
    scopeId: scopeId,
    description: 'Forward thread',
    keyDownHandler: () => {
      // TODO: Populate to field
      // TODO: Attachments from last/current selected message
      // handlers.setReplyMode('forward');
      return true;
    },
    hotkeyToken: TOKENS.email.forward,
    displayPriority: 7,
  });
  registerHotkey({
    hotkey: 'arrowup',
    scopeId,
    description: 'Previous message',
    keyDownHandler: handlers.navigateToPreviousMessage,
    hotkeyToken: TOKENS.email.previousMessage,
  });
  registerHotkey({
    hotkey: 'arrowdown',
    scopeId,
    description: 'Next message',
    keyDownHandler: handlers.navigateToNextMessage,
    hotkeyToken: TOKENS.email.nextMessage,
  });
  registerHotkey({
    hotkey: 'escape',
    scopeId: scopeId,
    description: 'Cancel reply',
    keyDownHandler: () => {
      // handlers.setShowReply(false);
      return true;
    },
    hotkeyToken: TOKENS.email.cancelReply,
  });
}
