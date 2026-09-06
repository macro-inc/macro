import { createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import type { EmailThreadKeyboardHandlers } from '../core/thread-keyboard';
import { dependencies, message, thread } from '../tests/fixtures';
import { createEmailThreadState } from './email-thread-state';
import { createThreadNavigation } from './thread-navigation';

it('registers reply-all for the latest or selected message and ignores an empty thread', () => {
  let handlers: EmailThreadKeyboardHandlers | undefined;
  const state = createRoot((dispose) => {
    const [snapshot, setSnapshot] = createSignal(
      thread([message('first'), message('last')])
    );
    const deps = dependencies({
      thread: snapshot,
      isLoading: () => false,
      isFetching: () => false,
      isFetchingOlder: () => false,
      hasMore: () => false,
      fetchOlder() {},
      refresh() {},
    });
    const context = createEmailThreadState(deps);
    createThreadNavigation({ threadId: () => 'thread' }, context, deps, {
      registerKeyboard: (registered) => {
        handlers = registered;
      },
    });
    return { context, setSnapshot, dispose };
  });
  try {
    expect(handlers?.replyAllToFocusedMessage?.()).toBe(true);
    expect(state.context.replyRequest.messageId()).toBe('last');
    expect(state.context.replyRequest.replyType()).toBe('reply-all');
    state.context.messages.setFocused('first');
    expect(handlers?.replyAllToFocusedMessage?.()).toBe(true);
    expect(state.context.replyRequest.messageId()).toBe('first');
    expect(state.context.messages.replyingToMessageId()).toBe('first');
    state.setSnapshot(thread([]));
    expect(handlers?.replyAllToFocusedMessage?.()).toBe(false);
  } finally {
    state.dispose();
  }
});

it('leaves Enter to a focused button and still activates the thread container', () => {
  let handlers: EmailThreadKeyboardHandlers | undefined;
  const state = createRoot((dispose) => {
    const deps = dependencies({
      thread: () => thread([message('last')]),
      isLoading: () => false,
      isFetching: () => false,
      isFetchingOlder: () => false,
      hasMore: () => false,
      fetchOlder() {},
      refresh() {},
    });
    const context = createEmailThreadState(deps);
    createThreadNavigation({ threadId: () => 'thread' }, context, deps, {
      registerKeyboard: (registered) => {
        handlers = registered;
      },
    });
    return { context, dispose };
  });
  const container = document.createElement('div');
  container.tabIndex = 0;
  const button = document.createElement('button');
  button.textContent = 'Remove attachment';
  container.append(button);
  document.body.append(container);

  try {
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(handlers?.activate()).toBe(false);
    expect(state.context.replyRequest.messageId()).toBeUndefined();

    container.focus();
    expect(handlers?.activate()).toBe(true);
    expect(state.context.replyRequest.messageId()).toBe('last');
    expect(state.context.replyRequest.replyType()).toBe('reply-all');
  } finally {
    container.remove();
    state.dispose();
  }
});
