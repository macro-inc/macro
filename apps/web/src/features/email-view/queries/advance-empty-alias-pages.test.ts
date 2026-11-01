import { batch, createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { advanceEmptyAliasPages } from './advance-empty-alias-pages';

it('waits for membership, advances once, and stops when a match is published', async () => {
  const root = createRoot((dispose) => {
    const [ready, setReady] = createSignal(false);
    const [matched, setMatched] = createSignal(false);
    const loadMore = vi.fn(async () => {
      setMatched(true);
    });
    advanceEmptyAliasPages({
      scope: () => 'alias',
      enabled: () => true,
      ready,
      hasItems: matched,
      hasNextPage: () => true,
      loadMore,
    });
    return { dispose, setReady, loadMore };
  });
  try {
    expect(root.loadMore).not.toHaveBeenCalled();
    root.setReady(true);
    await vi.waitFor(() => expect(root.loadMore).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(root.loadMore).toHaveBeenCalledOnce();
  } finally {
    root.dispose();
  }
});

it('latches a failed advance until an explicit retry', async () => {
  const root = createRoot((dispose) => {
    const [hasNextPage, setHasNextPage] = createSignal(true);
    const loadMore = vi
      .fn(async () => {
        setHasNextPage(false);
      })
      .mockRejectedValueOnce(new Error('Offline'));
    const advance = advanceEmptyAliasPages({
      scope: () => 'alias',
      enabled: () => true,
      ready: () => true,
      hasItems: () => false,
      hasNextPage,
      loadMore,
    });
    return { dispose, loadMore, advance };
  });
  try {
    await vi.waitFor(() =>
      expect(root.advance.error()).toEqual(new Error('Offline'))
    );
    expect(root.loadMore).toHaveBeenCalledOnce();
    root.advance.resetError();
    await vi.waitFor(() => expect(root.loadMore).toHaveBeenCalledTimes(2));
    expect(root.advance.error()).toBeUndefined();
  } finally {
    root.dispose();
  }
});

it('forgets a failed scope when visiting a different already-populated scope', async () => {
  const root = createRoot((dispose) => {
    const [scope, setScope] = createSignal('old');
    const [matched, setMatched] = createSignal(false);
    const loadMore = vi
      .fn(async () => {
        setMatched(true);
      })
      .mockRejectedValueOnce(new Error('Old failure'));
    const advance = advanceEmptyAliasPages({
      scope,
      enabled: () => true,
      ready: () => true,
      hasItems: matched,
      hasNextPage: () => true,
      loadMore,
    });
    return { dispose, setScope, setMatched, loadMore, advance };
  });
  try {
    await vi.waitFor(() =>
      expect(root.advance.error()).toEqual(new Error('Old failure'))
    );
    batch(() => {
      root.setScope('populated');
      root.setMatched(true);
    });
    expect(root.advance.error()).toBeUndefined();
    batch(() => {
      root.setScope('old');
      root.setMatched(false);
    });
    await vi.waitFor(() => expect(root.loadMore).toHaveBeenCalledTimes(2));
    expect(root.advance.error()).toBeUndefined();
  } finally {
    root.dispose();
  }
});

it('does not attach a previous scope failure to the new alias', async () => {
  let reject!: (error: Error) => void;
  const oldRequest = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  const root = createRoot((dispose) => {
    const [scope, setScope] = createSignal('old');
    const [matched, setMatched] = createSignal(false);
    const loadMore = vi
      .fn(async () => {
        setMatched(true);
      })
      .mockReturnValueOnce(oldRequest);
    const advance = advanceEmptyAliasPages({
      scope,
      enabled: () => true,
      ready: () => true,
      hasItems: matched,
      hasNextPage: () => true,
      loadMore,
    });
    return { dispose, setScope, loadMore, advance };
  });
  try {
    await vi.waitFor(() => expect(root.loadMore).toHaveBeenCalledOnce());
    root.setScope('new');
    reject(new Error('Old request failed'));
    await vi.waitFor(() => expect(root.loadMore).toHaveBeenCalledTimes(2));
    expect(root.advance.error()).toBeUndefined();
  } finally {
    root.dispose();
  }
});
