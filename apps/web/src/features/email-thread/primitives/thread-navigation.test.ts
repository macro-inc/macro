import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { EmailThreadKeyboardHandlers } from '../core/thread-keyboard';
import { dependencies, message, thread } from '../tests/fixtures';
import { createEmailThreadState } from './email-thread-state';
import { createThreadNavigation } from './thread-navigation';

afterEach(() => {
  if (vi.isFakeTimers()) vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

function navigationWithList(ids: string[]) {
  vi.useFakeTimers();
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const container = document.createElement('div');
  container.tabIndex = 0;
  container.scrollBy = vi.fn();
  for (const id of ids) {
    const card = document.createElement('div');
    card.dataset.messageBodyId = id;
    container.append(card);
  }
  document.body.append(container);
  let handlers: EmailThreadKeyboardHandlers | undefined;
  const state = createRoot((dispose) => {
    const deps = dependencies({
      thread: () => thread(ids.map((id) => message(id))),
      isLoading: () => false,
      isFetching: () => false,
      isFetchingOlder: () => false,
      hasMore: () => false,
      fetchOlder() {},
      refresh() {},
    });
    const host = {
      focusContainer: () => container.focus({ preventScroll: true }),
      registerKeyboard: (registered: EmailThreadKeyboardHandlers) => {
        handlers = registered;
      },
    };
    const context = createEmailThreadState(deps, host);
    const navigation = createThreadNavigation(
      { threadId: () => 'thread' },
      context,
      deps,
      host
    );
    context.registerMessagesList(container);
    return { context, navigation, dispose };
  });
  return {
    ...state,
    container,
    handlers: () => handlers,
    dispose() {
      state.dispose();
      container.remove();
    },
  };
}

it.each(['next', 'previous'] as const)(
  '%s-message navigation takes focus from the old details button before Enter expands the selected message',
  (direction) => {
    const state = navigationWithList(['first', 'middle', 'last']);
    const button = document.createElement('button');
    button.textContent = 'Message details';
    state.container.append(button);
    try {
      state.context.messages.setFocused(
        direction === 'next' ? 'first' : 'last'
      );
      button.focus();
      const handlers = state.handlers();
      const moved =
        direction === 'next'
          ? handlers?.navigateToNextMessage()
          : handlers?.navigateToPreviousMessage();
      expect(moved).toBe(true);
      expect(document.activeElement).toBe(state.container);
      expect(state.context.messages.focusedID()).toBe('middle');
      expect(handlers?.activate()).toBe(true);
      expect(state.context.messages.expandedBodyIds.middle).toBe(true);
      expect(state.context.replyRequest.messageId()).toBeUndefined();
    } finally {
      state.dispose();
    }
  }
);

it('retains Enter activation of the focused hidden-message button', () => {
  const state = navigationWithList([
    'first',
    'second',
    'third',
    'fourth',
    'fifth',
    'last',
  ]);
  const button = document.createElement('button');
  button.dataset.hiddenMessages = '';
  state.container.append(button);
  try {
    button.focus();
    state.context.messages.setHiddenChipFocused(true);
    expect(state.handlers()?.activate()).toBe(true);
    expect(state.navigation.showMiddleMessages()).toBe(true);
    expect(state.context.messages.focusedID()).toBe('second');
    expect(state.context.replyRequest.messageId()).toBeUndefined();
  } finally {
    state.dispose();
  }
});
