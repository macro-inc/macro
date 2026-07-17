import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';

interface EmailHotkeyHandlers {
  replyToFocusedMessage: () => boolean;
  replyAllToFocusedMessage?: () => boolean;
  forwardFocusedMessage: () => boolean;
  blockSender: () => boolean;
  markDone: () => boolean;
  markNotDone: () => boolean;
  /** Gates which of Mark done / Mark as not done is active. */
  isThreadDone: () => boolean;
  markSenderSignal: () => boolean;
  markSenderNoise: () => boolean;
  navigateToPreviousMessage: () => boolean;
  navigateToNextMessage: () => boolean;
}

export function registerEmailHotkeys(
  scopeId: string,
  handlers: EmailHotkeyHandlers
) {
  if (handlers.replyAllToFocusedMessage) {
    registerHotkey({
      hotkey: 'opt+r',
      scopeId: scopeId,
      description: 'Reply all to message',
      keyDownHandler: handlers.replyAllToFocusedMessage,
      hotkeyToken: TOKENS.email.replyAll,
      displayPriority: 8,
    });
  }

  registerHotkey({
    hotkey: 'r',
    scopeId: scopeId,
    description: 'Reply to message',
    keyDownHandler: handlers.replyToFocusedMessage,
    hotkeyToken: TOKENS.email.reply,
    displayPriority: 9,
  });

  registerHotkey({
    hotkey: 'f',
    scopeId: scopeId,
    description: 'Forward message',
    keyDownHandler: handlers.forwardFocusedMessage,
    hotkeyToken: TOKENS.email.forward,
    displayPriority: 7,
  });
  registerHotkey({
    hotkey: 'e',
    scopeId,
    description: 'Mark done',
    keyDownHandler: handlers.markDone,
    hotkeyToken: TOKENS.entity.action.markDone,
    displayPriority: 10,
    condition: () => !handlers.isThreadDone(),
  });
  registerHotkey({
    hotkey: 'shift+e',
    scopeId,
    description: 'Mark as not done',
    keyDownHandler: handlers.markNotDone,
    hotkeyToken: TOKENS.entity.action.markNotDone,
    displayPriority: 10,
    condition: () => handlers.isThreadDone(),
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
