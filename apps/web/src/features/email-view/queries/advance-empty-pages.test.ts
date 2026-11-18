import { batch, createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { advanceEmptyPages, MAX_PAGES_PER_LOAD } from './advance-empty-pages';

it('waits for membership, advances once, and stops when a match is published', async () => {
  const root = createRoot((dispose) => {
    const [ready, setReady] = createSignal(false);
    const [matched, setMatched] = createSignal(false);
    const loadMore = vi.fn(async () => {
      setMatched(true);
    });
    advanceEmptyPages({
      scope: () => 'alias',
      enabled: () => true,
      ready,
      rows: () => (matched() ? 1 : 0),
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
    const advance = advanceEmptyPages({
      scope: () => 'alias',
      enabled: () => true,
      ready: () => true,
      rows: () => 0,
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
    const advance = advanceEmptyPages({
      scope,
      enabled: () => true,
      ready: () => true,
      rows: () => (matched() ? 1 : 0),
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
    const advance = advanceEmptyPages({
      scope,
      enabled: () => true,
      ready: () => true,
      rows: () => (matched() ? 1 : 0),
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

it('stops a first page without rows after the per-load page cap', async () => {
  const root = createRoot((dispose) => {
    const loadMore = vi.fn(async () => {});
    const advance = advanceEmptyPages({
      scope: () => 'archived',
      enabled: () => true,
      ready: () => true,
      rows: () => 0,
      hasNextPage: () => true,
      loadMore,
    });
    return { dispose, loadMore, advance };
  });
  try {
    await vi.waitFor(() => expect(root.advance.stoppedShort()).toBe(true));
    expect(root.loadMore).toHaveBeenCalledTimes(MAX_PAGES_PER_LOAD - 1);
  } finally {
    root.dispose();
  }
});

it('reads on after Load More until a page adds a row', async () => {
  const root = createRoot((dispose) => {
    const [rows, setRows] = createSignal(3);
    const loadMore = vi
      .fn(async () => {})
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        setRows(4);
      });
    const advance = advanceEmptyPages({
      scope: () => 'archived',
      enabled: () => true,
      ready: () => true,
      rows,
      hasNextPage: () => true,
      loadMore,
    });
    return { dispose, loadMore, advance, rows };
  });
  try {
    expect(root.loadMore).not.toHaveBeenCalled();
    await root.advance.loadMore();
    await vi.waitFor(() => expect(root.rows()).toBe(4));
    await Promise.resolve();
    expect(root.loadMore).toHaveBeenCalledTimes(3);
    expect(root.advance.stoppedShort()).toBe(false);
  } finally {
    root.dispose();
  }
});

it('ends a Load More at the page cap, then reads on again when asked', async () => {
  const root = createRoot((dispose) => {
    const loadMore = vi.fn(async () => {});
    const advance = advanceEmptyPages({
      scope: () => 'archived',
      enabled: () => true,
      ready: () => true,
      rows: () => 3,
      hasNextPage: () => true,
      loadMore,
    });
    return { dispose, loadMore, advance };
  });
  try {
    await vi.waitFor(() => expect(root.advance.stoppedShort()).toBe(false));
    await root.advance.loadMore();
    await vi.waitFor(() => expect(root.advance.stoppedShort()).toBe(true));
    expect(root.loadMore).toHaveBeenCalledTimes(MAX_PAGES_PER_LOAD);
    await root.advance.loadMore();
    expect(root.advance.stoppedShort()).toBe(false);
    await vi.waitFor(() => expect(root.advance.stoppedShort()).toBe(true));
    expect(root.loadMore).toHaveBeenCalledTimes(2 * MAX_PAGES_PER_LOAD);
  } finally {
    root.dispose();
  }
});

it('joins a Load More to the page a read-on is already fetching', async () => {
  let finish = () => {};
  const root = createRoot((dispose) => {
    const [rows, setRows] = createSignal(0);
    const loadMore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            setRows(1);
            resolve();
          };
        })
    );
    const advance = advanceEmptyPages({
      scope: () => 'archived',
      enabled: () => true,
      ready: () => true,
      rows,
      hasNextPage: () => true,
      loadMore,
    });
    return { dispose, loadMore, advance };
  });
  try {
    await vi.waitFor(() => expect(root.loadMore).toHaveBeenCalledOnce());
    const pending = root.advance.loadMore();
    finish();
    await pending;
    expect(root.loadMore).toHaveBeenCalledOnce();
  } finally {
    root.dispose();
  }
});

it('fetches one page on Load More while reading on is disabled', async () => {
  const root = createRoot((dispose) => {
    const loadMore = vi.fn(async () => {});
    const advance = advanceEmptyPages({
      scope: () => 'reminders',
      enabled: () => false,
      ready: () => true,
      rows: () => 0,
      hasNextPage: () => true,
      loadMore,
    });
    return { dispose, loadMore, advance };
  });
  try {
    await root.advance.loadMore();
    await Promise.resolve();
    expect(root.loadMore).toHaveBeenCalledOnce();
    expect(root.advance.stoppedShort()).toBe(false);
  } finally {
    root.dispose();
  }
});
