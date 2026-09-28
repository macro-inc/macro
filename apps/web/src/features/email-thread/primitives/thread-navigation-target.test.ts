import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createThreadContext, message, thread } from '../tests/fixtures';
import { createEmailThreadState } from './email-thread-state';
import { createThreadNavigation } from './thread-navigation';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(
  target: string,
  ids: string[],
  older?: string[],
  fetchWait?: Promise<void>
) {
  vi.useFakeTimers();
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const container = document.createElement('div');
  container.scrollBy = vi.fn();
  const render = (ids: string[]) => {
    container.replaceChildren(
      ...ids.map((id) => {
        const element = document.createElement('div');
        element.dataset.messageBodyId = id;
        return element;
      })
    );
  };
  render(ids);
  document.body.append(container);
  const fixture = createRoot((dispose) => {
    const [threadId, setThreadId] = createSignal('thread');
    const [isFetching, setFetching] = createSignal(false);
    const [isTouch, setTouch] = createSignal(false);
    const [isActive, setActive] = createSignal(true);
    const [snapshot, setSnapshot] = createSignal(
      thread(ids.map((id) => message(id)))
    );
    const [hasMore, setHasMore] = createSignal(Boolean(older));
    const fetchOlder = vi.fn(async () => {
      await fetchWait;
      const next = [...(older ?? []), ...ids];
      render(next);
      setSnapshot(thread(next.map((id) => message(id))));
      setHasMore(false);
    });
    const source = createThreadContext({
      id: threadId,
      thread: snapshot,
      isFetching,
      hasMore,
      fetchOlder,
    });
    source.isTouch = isTouch;
    const [targetMessageId, setTarget] = createSignal<string | undefined>(
      target
    );
    const host = { targetMessageId, isActive };
    const state = createEmailThreadState(source, host);
    const navigation = createThreadNavigation(
      { threadId },
      state,
      source,
      host
    );
    state.registerMessagesList(container);
    state.registerMessagesContainer(container);
    return {
      state,
      navigation,
      fetchOlder,
      setTarget,
      setFetching,
      setTouch,
      setActive,
      setThreadId,
      setSnapshot,
      dispose,
    };
  });
  return {
    ...fixture,
    container,
    dispose: () => {
      fixture.dispose();
      container.remove();
    },
  };
}

it('expands and positions a loaded deep link, then releases its highlight', async () => {
  const fixture = setup('target', ['first', 'target', 'last']);
  try {
    await vi.advanceTimersByTimeAsync(20);
    expect(fixture.state.messages.expandedBodyIds.target).toBe(true);
    expect(fixture.state.messages.focusedId()).toBe('target');
    expect(fixture.container.scrollBy).toHaveBeenCalledOnce();
    expect(fixture.state.messages.targetMessageId()).toBe('target');
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.state.isScrollingToMessage()).toBe(false);
    await vi.advanceTimersByTimeAsync(800);
    expect(fixture.state.messages.targetMessageId()).toBeUndefined();
    expect(fixture.fetchOlder).not.toHaveBeenCalled();
  } finally {
    fixture.dispose();
  }
});

it('loads an older page before positioning an unloaded deep link', async () => {
  const fixture = setup('older', ['newest'], ['older']);
  try {
    expect(fixture.container.scrollBy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(fixture.fetchOlder).toHaveBeenCalledOnce();
    expect(fixture.state.messages.focusedId()).toBe('older');
    expect(fixture.container.scrollBy).toHaveBeenCalledOnce();
  } finally {
    fixture.dispose();
  }
});

it('does not scroll when the target is absent from every available page', async () => {
  const fixture = setup('missing', ['newest'], ['older']);
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect(fixture.fetchOlder).toHaveBeenCalledOnce();
    expect(fixture.container.scrollBy).not.toHaveBeenCalled();
    expect(fixture.state.messages.focusedId()).toBeUndefined();
  } finally {
    fixture.dispose();
  }
});

it('keeps the replacement target highlighted for its own full duration', async () => {
  const fixture = setup('target', ['first', 'target', 'last']);
  try {
    await vi.advanceTimersByTimeAsync(420);
    fixture.setTarget('last');
    await vi.advanceTimersByTimeAsync(420);
    expect(fixture.state.messages.focusedId()).toBe('last');
    expect(fixture.state.messages.targetMessageId()).toBe('last');
    await vi.advanceTimersByTimeAsync(500);
    expect(fixture.state.messages.targetMessageId()).toBeUndefined();
  } finally {
    fixture.dispose();
  }
});

it('cancels a queued layout callback when the thread unmounts', async () => {
  const fixture = setup('target', ['first', 'target', 'last']);
  await vi.advanceTimersByTimeAsync(0);
  fixture.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fixture.container.scrollBy).not.toHaveBeenCalled();
});

it('ignores an older navigation result after a new target has been positioned', async () => {
  let resolveFetch!: () => void;
  const pending = new Promise<void>((resolve) => {
    resolveFetch = resolve;
  });
  const fixture = setup('older', ['first', 'next', 'last'], ['older'], pending);
  try {
    fixture.setTarget('next');
    await vi.advanceTimersByTimeAsync(20);
    expect(fixture.state.messages.focusedId()).toBe('next');
    resolveFetch();
    await vi.advanceTimersByTimeAsync(100);
    expect(fixture.state.messages.focusedId()).toBe('next');
    expect(fixture.container.scrollBy).toHaveBeenCalledOnce();
  } finally {
    fixture.dispose();
  }
});

it('ignores a page response after the thread unmounts', async () => {
  let resolveFetch!: () => void;
  const pending = new Promise<void>((resolve) => {
    resolveFetch = resolve;
  });
  const fixture = setup('older', ['newest'], ['older'], pending);
  fixture.dispose();
  resolveFetch();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fixture.container.scrollBy).not.toHaveBeenCalled();
});

it('cancels a queued frame before a removed target can wait on a busy query', async () => {
  const fixture = setup('target', ['first', 'target', 'last']);
  try {
    await vi.advanceTimersByTimeAsync(0);
    fixture.setFetching(true);
    fixture.setTarget(undefined);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.container.scrollBy).not.toHaveBeenCalled();
    expect(fixture.state.messages.targetMessageId()).toBeUndefined();
    fixture.setFetching(false);
    expect(fixture.state.initialLoadComplete()).toBe(true);
  } finally {
    fixture.dispose();
  }
});

it('cancels the old highlight while a replacement waits for an inactive mobile view', async () => {
  const fixture = setup('target', ['first', 'target', 'last']);
  try {
    await vi.advanceTimersByTimeAsync(20);
    fixture.setTouch(true);
    fixture.setActive(false);
    fixture.setTarget('last');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.state.messages.targetMessageId()).toBe('last');
    expect(fixture.container.scrollBy).toHaveBeenCalledOnce();
    fixture.setActive(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(fixture.state.messages.focusedId()).toBe('last');
    expect(fixture.container.scrollBy).toHaveBeenCalledTimes(2);
  } finally {
    fixture.dispose();
  }
});

it('resets navigation and hidden-message focus when the thread changes while loading', async () => {
  const fixture = setup('target', ['first', 'target', 'last']);
  try {
    await vi.advanceTimersByTimeAsync(0);
    fixture.navigation.setUserOpenedMiddle(true);
    fixture.state.messages.setHiddenChipFocused(true);
    fixture.setFetching(true);
    fixture.setThreadId('other');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.container.scrollBy).not.toHaveBeenCalled();
    expect(fixture.state.messages.hiddenChipFocused()).toBe(false);
    expect(fixture.state.initialLoadComplete()).toBe(false);
    fixture.setSnapshot(
      thread(
        ['first', 'target', 'last'].map((id) => message(id)),
        { db_id: 'other' }
      )
    );
    fixture.setFetching(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(fixture.state.messages.focusedId()).toBe('target');
    expect(fixture.container.scrollBy).toHaveBeenCalledOnce();
    expect(fixture.state.initialLoadComplete()).toBe(true);
  } finally {
    fixture.dispose();
  }
});

it('does not restart a cleared target on a cache update, but supports opening it again', async () => {
  const fixture = setup('target', ['first', 'target', 'last']);
  try {
    await vi.advanceTimersByTimeAsync(1000);
    fixture.setSnapshot(
      thread(['first', 'target', 'last'].map((id) => message(id)))
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(fixture.state.messages.targetMessageId()).toBeUndefined();
    expect(fixture.container.scrollBy).toHaveBeenCalledOnce();
    fixture.setTarget(undefined);
    fixture.setTarget('target');
    await vi.advanceTimersByTimeAsync(20);
    expect(fixture.state.messages.targetMessageId()).toBe('target');
    expect(fixture.container.scrollBy).toHaveBeenCalledTimes(2);
  } finally {
    fixture.dispose();
  }
});
