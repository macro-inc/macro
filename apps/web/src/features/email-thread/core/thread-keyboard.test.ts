import { describe, expect, it, vi } from 'vitest';
import {
  delegateThreadKeyboard,
  type EmailThreadKeyboardHandlers,
} from './thread-keyboard';

function handlers(): EmailThreadKeyboardHandlers {
  return {
    activate: vi.fn(() => true),
    cancel: vi.fn(() => true),
    replyToFocusedMessage: vi.fn(() => true),
    replyAllToFocusedMessage: vi.fn(() => true),
    forwardFocusedMessage: vi.fn(() => true),
    blockSender: vi.fn(() => true),
    markDone: vi.fn(() => true),
    markNotDone: vi.fn(() => true),
    isThreadDone: vi.fn(() => true),
    canMarkNotDone: vi.fn(() => true),
    markUnread: vi.fn(() => true),
    markRead: vi.fn(() => true),
    isThreadMarkedUnread: vi.fn(() => true),
    markSenderSignal: vi.fn(() => true),
    markSenderNoise: vi.fn(() => true),
    navigateToPreviousMessage: vi.fn(() => true),
    navigateToNextMessage: vi.fn(() => true),
    expandFocusedMessage: vi.fn(() => true),
    expandAllMessages: vi.fn(() => true),
  };
}

describe('delegateThreadKeyboard', () => {
  it('acts on the handlers current returns at the time of the key', () => {
    const first = handlers();
    const second = handlers();
    let current: EmailThreadKeyboardHandlers | undefined = first;
    const keys = delegateThreadKeyboard(
      () => current,
      () => true
    );

    keys.markDone();
    current = second;
    keys.markDone();

    expect(first.markDone).toHaveBeenCalledOnce();
    expect(second.markDone).toHaveBeenCalledOnce();
  });

  it('holds actions while not ready, swallowing their keys', () => {
    const thread = handlers();
    let ready = false;
    const keys = delegateThreadKeyboard(
      () => thread,
      () => ready
    );

    expect(keys.markDone()).toBe(true);
    expect(keys.replyToFocusedMessage()).toBe(true);
    expect(thread.markDone).not.toHaveBeenCalled();
    expect(thread.replyToFocusedMessage).not.toHaveBeenCalled();

    ready = true;
    keys.markDone();
    expect(thread.markDone).toHaveBeenCalledOnce();
  });

  it('keeps Escape, state gates, message navigation and expanding working while held', () => {
    const thread = handlers();
    const keys = delegateThreadKeyboard(
      () => thread,
      () => false
    );

    keys.cancel();
    keys.isThreadDone();
    keys.navigateToNextMessage();
    keys.expandFocusedMessage();

    expect(thread.cancel).toHaveBeenCalledOnce();
    expect(thread.isThreadDone).toHaveBeenCalledOnce();
    expect(thread.navigateToNextMessage).toHaveBeenCalledOnce();
    expect(thread.expandFocusedMessage).toHaveBeenCalledOnce();
  });

  it('lets every key fall through before the thread registers handlers', () => {
    const keys = delegateThreadKeyboard(
      () => undefined,
      () => true
    );

    expect(keys.markDone()).toBe(false);
    expect(keys.cancel()).toBe(false);
    expect(keys.isThreadDone()).toBe(false);
  });
});
