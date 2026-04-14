import { TOKENS } from '@core/hotkey/tokens';
import { registerHotkey } from 'core/hotkey/hotkeys';

export interface EmailHotkeyHandlers {
  blockSender: () => boolean;
  markSenderSignal: () => boolean;
  markSenderNoise: () => boolean;
  navigateToPreviousMessage: () => boolean;
  navigateToNextMessage: () => boolean;
}

export function registerEmailHotkeys(
  scopeId: string,
  handlers: EmailHotkeyHandlers
) {
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
    scopeId: scopeId,
    description: 'Block sender',
    keyDownHandler: handlers.blockSender,
    hotkeyToken: TOKENS.email.blockSender,
    displayPriority: 5,
  });
  registerHotkey({
    scopeId: scopeId,
    description: 'Mark sender as Signal',
    keyDownHandler: handlers.markSenderSignal,
    hotkeyToken: TOKENS.email.markSenderSignal,
    displayPriority: 5,
  });
  registerHotkey({
    scopeId: scopeId,
    description: 'Mark sender as Noise',
    keyDownHandler: handlers.markSenderNoise,
    hotkeyToken: TOKENS.email.markSenderNoise,
    displayPriority: 5,
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
}
