import { thrownResultErrorHasCode } from '@core/util/result';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import {
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
} from '@graphql-cache/index';
import type { Message } from '@service-storage/messages';
import { until } from '@solid-primitives/promise';
import { onlineManager } from '@tanstack/solid-query';
import { CombinedError } from '@urql/core';
import { createEffect, createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { markChannelCacheUnsupported } from '../channel-flag';
import { channelMessageKey, mapChannelMessage } from '../channel-map';
import { VIEW_RETRY_MS, viewRetryWait } from '../channel-network';
import type { ChannelViewChange } from '../channel-sync-runtime';
import {
  createLocalChannelThread,
  type FetchChannelThreadPage,
  loadChannelThread,
} from '../channel-thread';
import {
  applied,
  CHANNEL_ID,
  devicePage,
  fakeHost,
  graphqlMessage,
} from './fixtures';

vi.mock('../channel-flag', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../channel-flag')>()),
  markChannelCacheUnsupported: vi.fn(),
}));

const trace = vi.hoisted(() => ({ depth: 0 }));

const span = vi.hoisted(() => ({
  setAttr: () => undefined,
  error: () => undefined,
  run: <T>(operation: () => T) => operation(),
  span: async (_name: string, run: (child: unknown) => unknown) => run(span),
}));

vi.mock('@macro-inc/observability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@macro-inc/observability')>()),
  Telemetry: {
    error: vi.fn(),
    // Counts the trace a load captured as entered while its work runs.
    captureContext: () => ({
      run: <T>(operation: () => T) => {
        trace.depth += 1;
        try {
          return operation();
        } finally {
          trace.depth -= 1;
        }
      },
    }),
    span: async (_name: string, run: (span: unknown) => unknown) => run(span),
  },
}));

const root = graphqlMessage(1, {
  thread: {
    resolved: false,
    deletedAt: null,
    createdAt: '2026-11-01T10:00:01.000123Z',
    updatedAt: '2026-11-01T10:00:03.000123Z',
    userId: 'macro|sender@example.test',
    replyCount: 2,
    latestReplyAt: '2026-11-01T10:00:03.000123Z',
    preview: [],
  },
});
const ROOT_ID = root.id;
const first = graphqlMessage(2, { threadId: ROOT_ID });
const second = graphqlMessage(3, { threadId: ROOT_ID });

function serverThread(): FetchChannelThreadPage {
  return vi.fn(async () => ({
    page: {
      root,
      replies: [first, second],
      olderCursor: null,
      newerCursor: null,
      seq: '12',
    },
    cached: Promise.resolve(applied('12')),
  }));
}

/** What each page the server sent proved, as it was sent to the cache. */
async function commitsOf(fetchPage: FetchChannelThreadPage) {
  const { calls, results } = vi.mocked(fetchPage).mock;
  return Promise.all(
    calls.map(async ([, { commit }], at) => {
      const { page } = await results[at]!.value;
      return commit?.(page);
    })
  );
}

function runtime() {
  const inTrace: boolean[] = [];
  const listeners = new Set<(change: ChannelViewChange) => void>();
  return {
    open: vi.fn(() => () => undefined),
    onChanged: vi.fn(
      (_channelId: string, listener: (change: ChannelViewChange) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    ),
    noteServerRead: vi.fn(),
    ensureCurrent: vi.fn(async () => {
      inTrace.push(trace.depth > 0);
      return 'current' as const;
    }),
    inTrace,
    epoch: () => 0,
    change: () => {
      for (const listener of listeners) listener('changed');
    },
    resume: () => {
      for (const listener of listeners) listener('resumed');
    },
  };
}

describe('loadChannelThread', () => {
  it('reads a thread the device holds without asking the server', async () => {
    const host = fakeHost(
      [devicePage([channelMessageKey(second.id), channelMessageKey(first.id)])],
      { records: [root, first, second] }
    );
    const fetchPage = serverThread();

    const loaded = await loadChannelThread(host, CHANNEL_ID, ROOT_ID, {
      fetchPage,
    });

    expect(loaded).toMatchObject({ source: 'device' });
    if (loaded === 'unsupported') throw new Error('unexpected');
    expect(loaded.thread.replies.map((reply) => reply.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(loaded.thread.root.id).toBe(ROOT_ID);
    expect(host.reads[0]).toMatchObject({ threadRootId: ROOT_ID });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('fetches a thread the device lacks and stores it as held', async () => {
    const host = fakeHost([devicePage([], { covered: false })]);

    const fetchPage = serverThread();
    const loaded = await loadChannelThread(host, CHANNEL_ID, ROOT_ID, {
      fetchPage,
    });

    expect(loaded).toMatchObject({
      source: 'server',
      stored: 'held',
      readSeq: '12',
    });
    expect(await commitsOf(fetchPage)).toEqual([
      {
        channelId: CHANNEL_ID,
        coverage: [
          {
            threadRootId: ROOT_ID,
            start: CHANNEL_TIMELINE_START,
            end: CHANNEL_TIMELINE_HEAD,
          },
        ],
        seq: '12',
        watermark: { kind: 'lower' },
      },
    ]);
  });

  it('says so when the cache session changed before the thread was stored', async () => {
    const host = fakeHost([devicePage([], { covered: false })]);
    const fetchPage = vi.fn<FetchChannelThreadPage>(async () => ({
      page: {
        root,
        replies: [first, second],
        olderCursor: null,
        newerCursor: null,
        seq: '12',
      },
      cached: Promise.reject(new StaleCacheAuthorityError()),
    }));

    const loaded = await loadChannelThread(host, CHANNEL_ID, ROOT_ID, {
      fetchPage,
    });

    expect(loaded).toMatchObject({
      source: 'server',
      stored: 'session-changed',
    });
  });

  it('leaves no store rejection unhandled when a later page fails', async () => {
    const host = fakeHost([devicePage([], { covered: false })]);
    const fetchPage = vi.fn<FetchChannelThreadPage>(async (input) => {
      if (input.before) throw new Error('offline');
      return {
        page: {
          root,
          replies: [second],
          olderCursor: 'older',
          newerCursor: null,
          seq: '12',
        },
        cached: Promise.reject(new Error('write lost')),
      };
    });

    await expect(
      loadChannelThread(host, CHANNEL_ID, ROOT_ID, { fetchPage })
    ).rejects.toThrow('offline');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('stops asking for pages once the load is aborted', async () => {
    const host = fakeHost([devicePage([], { covered: false })]);
    const abort = new AbortController();
    const fetchPage = vi.fn<FetchChannelThreadPage>(async () => {
      // The person closes the thread while the first page is in flight.
      abort.abort();
      return {
        page: {
          root,
          replies: [first],
          olderCursor: 'older',
          newerCursor: null,
          seq: '9',
        },
        cached: Promise.resolve(applied('9')),
      };
    });

    await expect(
      loadChannelThread(host, CHANNEL_ID, ROOT_ID, {
        fetchPage,
        signal: abort.signal,
      })
    ).rejects.toThrow();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('reads over REST on a host that cannot serve channels', async () => {
    const host = fakeHost([{ kind: 'unsupported' }]);

    expect(
      await loadChannelThread(host, CHANNEL_ID, ROOT_ID, {
        fetchPage: serverThread(),
      })
    ).toBe('unsupported');
  });
});

describe('createLocalChannelThread', () => {
  it('follows changes to a held thread by reading it again from the device', async () => {
    const third = graphqlMessage(4, { threadId: ROOT_ID });
    let keys = [channelMessageKey(second.id), channelMessageKey(first.id)];
    const host = fakeHost(() => devicePage(keys), {
      records: [root, first, second, third],
    });
    const sync = runtime();

    const thread = createRoot(() =>
      createLocalChannelThread(
        { host, runtime: sync, fetchPage: serverThread() },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      )
    );
    await vi.waitFor(() => expect(thread.replies()).toHaveLength(2));
    expect(sync.open).toHaveBeenCalledWith(CHANNEL_ID);
    expect(sync.ensureCurrent).toHaveBeenCalledWith(CHANNEL_ID);
    // The catch-up after the device read is part of the open's trace.
    expect(sync.inTrace).toEqual([true]);

    keys = [channelMessageKey(third.id), ...keys];
    sync.change();

    await vi.waitFor(() =>
      expect(thread.replies()?.map((reply) => reply.id)).toEqual([
        first.id,
        second.id,
        third.id,
      ])
    );
  });

  it('reads a held thread again when the read an outage ended in fails', async () => {
    let keys = [channelMessageKey(first.id)];
    const host = fakeHost(() => devicePage(keys), {
      records: [root, first, second],
    });
    const sync = runtime();
    const { thread, dispose } = createRoot((dispose) => ({
      dispose,
      thread: createLocalChannelThread(
        { host, runtime: sync, fetchPage: serverThread() },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      ),
    }));
    await vi.waitFor(() => expect(sync.ensureCurrent).toHaveBeenCalled());
    const lost = Promise.withResolvers<never>();
    vi.spyOn(host, 'channelTimeline').mockReturnValueOnce(lost.promise);
    sync.change();
    keys = [channelMessageKey(second.id), ...keys];
    sync.resume();
    lost.reject(new Error('cache was away'));
    await vi.waitFor(() => expect(thread.replies()).toHaveLength(2));
    dispose();
  });

  it('loads a thread again from the server when the device lost it', async () => {
    let covered = true;
    const host = fakeHost(
      () =>
        devicePage(
          covered
            ? [channelMessageKey(second.id), channelMessageKey(first.id)]
            : [],
          { covered }
        ),
      { records: [root, first, second] }
    );
    const sync = runtime();
    const fetchPage = serverThread();

    const thread = createRoot(() =>
      createLocalChannelThread(
        { host, runtime: sync, fetchPage },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      )
    );
    await vi.waitFor(() => expect(thread.replies()).toHaveLength(2));
    expect(fetchPage).not.toHaveBeenCalled();

    // Evicted: the next change finds no coverage.
    covered = false;
    sync.change();

    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(sync.noteServerRead).toHaveBeenCalledWith(CHANNEL_ID, {
        readSeq: '12',
        epoch: 0,
      })
    );
    expect(thread.replies()).toHaveLength(2);
  });

  it('reads a change that came while the device lost the thread and it loaded again', async () => {
    const third = graphqlMessage(4, { threadId: ROOT_ID });
    let covered = true;
    let keys = [channelMessageKey(second.id), channelMessageKey(first.id)];
    const host = fakeHost(() => devicePage(covered ? keys : [], { covered }), {
      records: [root, first, second, third],
    });
    const sync = runtime();
    const stored = Promise.withResolvers<ReturnType<typeof applied>>();
    const server = serverThread();
    const fetchPage = vi.fn<FetchChannelThreadPage>(async (input, options) => ({
      ...(await server(input, options)),
      cached: stored.promise,
    }));
    const { thread, dispose } = createRoot((dispose) => ({
      dispose,
      thread: createLocalChannelThread(
        { host, runtime: sync, fetchPage },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      ),
    }));
    await vi.waitFor(() => expect(thread.replies()).toHaveLength(2));
    covered = false;
    sync.change();
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalled());

    // The answer is stored, and another reply, before the store is known of.
    covered = true;
    keys = [channelMessageKey(third.id), ...keys];
    sync.change();
    stored.resolve(applied('12'));
    await vi.waitFor(() => expect(thread.replies()).toHaveLength(3));
    dispose();
  });

  it('shows no more of a thread the server says is gone', async () => {
    let covered = true;
    const host = fakeHost(() => devicePage([], { covered }), {
      records: [root],
    });
    const sync = runtime();
    const fetchPage = vi.fn<FetchChannelThreadPage>(async () => {
      throw new CombinedError({
        graphQLErrors: [{ message: 'gone', extensions: { code: 'NOT_FOUND' } }],
      });
    });
    const { thread, dispose } = createRoot((dispose) => ({
      dispose,
      thread: createLocalChannelThread(
        { host, runtime: sync, fetchPage },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      ),
    }));
    await vi.waitFor(() => expect(thread.thread()?.root.id).toBe(ROOT_ID));
    covered = false;
    sync.change();
    await vi.waitFor(() => expect(thread.thread()).toBeUndefined());
    // The code the app's readers know a missing thread by.
    expect(thrownResultErrorHasCode(thread.error(), 'NOT_FOUND')).toBe(true);
    dispose();
  });

  it('shows nothing of the thread it was on before', async () => {
    const other = graphqlMessage(5);
    const [rootId, setRootId] = createSignal(ROOT_ID);
    const host = fakeHost(
      ({ threadRootId }) =>
        devicePage([], { covered: threadRootId === ROOT_ID }),
      { records: [root, other] }
    );
    const answer = Promise.withResolvers<never>();
    const { thread, dispose } = createRoot((dispose) => ({
      dispose,
      thread: createLocalChannelThread(
        { host, runtime: runtime(), fetchPage: () => answer.promise },
        CHANNEL_ID,
        rootId,
        () => true,
        () => undefined
      ),
    }));
    await vi.waitFor(() => expect(thread.thread()?.root.id).toBe(ROOT_ID));
    setRootId(other.id);
    expect(thread.thread()).toBeUndefined();
    expect(thread.isPending()).toBe(true);
    answer.reject(new Error('refused'));
    await vi.waitFor(() => expect(thread.error()).toBeDefined());
    expect(thread.thread()).toBeUndefined();
    dispose();
  });

  it('stops asking the server for a thread whose device keeps losing what it stores', async () => {
    const host = fakeHost(() => devicePage([], { covered: false }));
    const sync = runtime();
    // The device reports a change for every store, the view's own included.
    sync.noteServerRead.mockImplementation(sync.change);
    const fetchPage = serverThread();
    const { thread, dispose } = createRoot((dispose) => ({
      dispose,
      thread: createLocalChannelThread(
        { host, runtime: sync, fetchPage },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      ),
    }));
    await vi.waitFor(() => expect(thread.replies()).toHaveLength(2));
    sync.change();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const asked = vi.mocked(fetchPage).mock.calls.length;
    expect(asked).toBeLessThan(10);

    sync.change();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchPage).toHaveBeenCalledTimes(asked);
    expect(thread.replies()).toHaveLength(2);
    dispose();
  });

  it('shows a reply the device has not sent of a thread read from the server', async () => {
    const unsent = graphqlMessage(4, { threadId: ROOT_ID });
    let held = false;
    const host = fakeHost(
      () =>
        devicePage(
          [unsent, second, first].map(({ id }) => channelMessageKey(id)),
          {
            covered: held,
          }
        ),
      { records: [root, first, second, unsent] }
    );
    const server = serverThread();
    const { thread, dispose } = createRoot((dispose) => ({
      dispose,
      thread: createLocalChannelThread(
        {
          host,
          runtime: runtime(),
          fetchPage: async (...args) => {
            const answer = await server(...args);
            held = true;
            return answer;
          },
        },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      ),
    }));
    // The device changes nothing that it would report.
    await vi.waitFor(() =>
      expect(thread.replies()?.map(({ id }) => id)).toEqual([
        first.id,
        second.id,
        unsent.id,
      ])
    );
    expect(server).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('loads a shown thread the device lost again after a wait that doubles', async () => {
    vi.useFakeTimers();
    let covered = true;
    const host = fakeHost(
      () =>
        devicePage(
          [channelMessageKey(second.id), channelMessageKey(first.id)],
          {
            covered,
          }
        ),
      { records: [root, first, second] }
    );
    const sync = runtime();
    const fetchPage = vi.fn<FetchChannelThreadPage>(async () => {
      throw new Error('service unavailable');
    });
    const { thread, dispose } = createRoot((dispose) => ({
      dispose,
      thread: createLocalChannelThread(
        { host, runtime: sync, fetchPage },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      ),
    }));
    try {
      await vi.advanceTimersByTimeAsync(0);
      covered = false;
      sync.change();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchPage).toHaveBeenCalledTimes(1);
      // The device lost it, then the server failed: two in a row.
      await vi.advanceTimersByTimeAsync(2 * VIEW_RETRY_MS);
      expect(fetchPage).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(4 * VIEW_RETRY_MS - 1);
      expect(fetchPage).toHaveBeenCalledTimes(2);
      covered = true;
      await vi.advanceTimersByTimeAsync(1);
      expect(thread.error()).toBeUndefined();
      expect(thread.replies()).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(0);

      // It follows the device again, and closed it waits for nothing.
      covered = false;
      sync.change();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchPage).toHaveBeenCalledTimes(3);
      dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      dispose();
      vi.useRealTimers();
    }
  });

  it('asks a device that does not store a thread again after a wait that doubles', async () => {
    vi.useFakeTimers();
    let stores = false;
    let covered = false;
    let keys = [channelMessageKey(first.id)];
    const host = fakeHost(() => devicePage(keys, { covered }), {
      records: [root, first, second],
    });
    const sync = runtime();
    const server = serverThread();
    const fetchPage = vi.fn<FetchChannelThreadPage>(async (...args) => {
      const answer = await server(...args);
      covered = stores;
      return stores
        ? answer
        : { ...answer, cached: Promise.reject(new Error('disk full')) };
    });
    const { thread, dispose } = createRoot((dispose) => ({
      dispose,
      thread: createLocalChannelThread(
        { host, runtime: sync, fetchPage },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      ),
    }));
    try {
      await vi.advanceTimersByTimeAsync(0);
      for (let retry = 0; retry < 6; retry += 1) {
        await vi.advanceTimersByTimeAsync(viewRetryWait(retry + 1) - 1);
        expect(fetchPage).toHaveBeenCalledTimes(1 + retry);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchPage).toHaveBeenCalledTimes(2 + retry);
      }
      expect(thread.replies()).toHaveLength(2);

      stores = true;
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchPage).toHaveBeenCalledTimes(8);
      expect(thread.replies()).toHaveLength(1);
      keys = [channelMessageKey(second.id), ...keys];
      sync.change();
      await vi.advanceTimersByTimeAsync(0);
      expect(thread.replies()).toHaveLength(2);
    } finally {
      dispose();
      vi.useRealTimers();
      onlineManager.setOnline(true);
    }
  });

  it('reads a held thread again after a wait when the device failed the read of a change', async () => {
    vi.useFakeTimers();
    let keys = [channelMessageKey(first.id)];
    const host = fakeHost(() => devicePage(keys), {
      records: [root, first, second],
    });
    const sync = runtime();
    const { thread, dispose } = createRoot((dispose) => ({
      dispose,
      thread: createLocalChannelThread(
        { host, runtime: sync, fetchPage: serverThread() },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      ),
    }));
    try {
      await vi.advanceTimersByTimeAsync(0);
      vi.spyOn(host, 'channelTimeline').mockRejectedValueOnce(
        new Error('busy')
      );
      keys = [channelMessageKey(second.id), ...keys];
      sync.change();
      await vi.advanceTimersByTimeAsync(0);
      expect(thread.replies()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(VIEW_RETRY_MS);
      expect(thread.replies()).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      dispose();
      vi.useRealTimers();
    }
  });

  it('loads a thread that failed with no connection again once it is back', async () => {
    const host = fakeHost(() => devicePage([], { covered: false }));
    let connected = false;
    const server = serverThread();
    const fetchPage = vi.fn<FetchChannelThreadPage>(async (input, options) => {
      if (!connected) throw new TypeError('Failed to fetch');
      return server(input, options);
    });
    onlineManager.setOnline(false);
    try {
      let dispose = () => {};
      const thread = createRoot((disposeRoot) => {
        dispose = disposeRoot;
        return createLocalChannelThread(
          { host, runtime: runtime(), fetchPage },
          CHANNEL_ID,
          () => ROOT_ID,
          () => true,
          () => undefined
        );
      });
      await vi.waitFor(() => expect(thread.error()).toBeDefined());

      // Nothing on screen asks for the thread again.
      connected = true;
      onlineManager.setOnline(true);
      await vi.waitFor(() =>
        expect(thread.replies()?.map((reply) => reply.id)).toEqual([
          first.id,
          second.id,
        ])
      );
      expect(thread.error()).toBeUndefined();
      dispose();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('loads a failed thread again once the connection is back after another thread closed', async () => {
    let connected = false;
    const host = fakeHost(
      () =>
        devicePage(
          [channelMessageKey(second.id), channelMessageKey(first.id)],
          {
            covered: connected && server.mock.calls.length > 0,
          }
        ),
      { records: [root, first, second] }
    );
    const server = vi.mocked(serverThread());
    const fetchPage = vi.fn<FetchChannelThreadPage>(async (input, options) => {
      if (!connected) throw new TypeError('Failed to fetch');
      return server(input, options);
    });
    const open = () => {
      let dispose = () => {};
      const thread = createRoot((disposeRoot) => {
        dispose = disposeRoot;
        return createLocalChannelThread(
          { host, runtime: runtime(), fetchPage },
          CHANNEL_ID,
          () => ROOT_ID,
          () => true,
          () => undefined
        );
      });
      return { thread, dispose };
    };
    onlineManager.setOnline(false);
    try {
      const closed = open();
      const kept = open();
      await vi.waitFor(() => {
        expect(closed.thread.error()).toBeDefined();
        expect(kept.thread.error()).toBeDefined();
      });
      closed.dispose();

      connected = true;
      onlineManager.setOnline(true);
      await vi.waitFor(() => expect(kept.thread.replies()).toHaveLength(2));
      expect(fetchPage).toHaveBeenCalledTimes(3);
      kept.dispose();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('loads a thread again when the connection came back before its request failed', async () => {
    const host = fakeHost(() => devicePage([], { covered: false }));
    const asked = Promise.withResolvers<void>();
    const pending =
      Promise.withResolvers<Awaited<ReturnType<FetchChannelThreadPage>>>();
    const fetchPage = vi
      .fn<FetchChannelThreadPage>()
      .mockImplementationOnce(() => {
        asked.resolve();
        return pending.promise;
      })
      .mockImplementation(serverThread());
    onlineManager.setOnline(false);
    const { thread, dispose } = createRoot((dispose) => ({
      dispose,
      thread: createLocalChannelThread(
        { host, runtime: runtime(), fetchPage },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      ),
    }));
    try {
      await asked.promise;
      // Back while the request sent with no connection is still out.
      onlineManager.setOnline(true);
      pending.reject(new TypeError('Failed to fetch'));

      await until(() => thread.replies()?.length === 2);
      expect(fetchPage).toHaveBeenCalledTimes(2);
    } finally {
      dispose();
      onlineManager.setOnline(true);
    }
  });

  it('loads nothing more once a thread closed over its failure', async () => {
    const host = fakeHost(() => devicePage([], { covered: false }));
    const asked = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    const pending =
      Promise.withResolvers<Awaited<ReturnType<FetchChannelThreadPage>>>();
    const fetchPage = vi
      .fn<FetchChannelThreadPage>()
      .mockImplementationOnce(() => {
        asked.resolve();
        return pending.promise;
      })
      .mockImplementation(serverThread());
    onlineManager.setOnline(false);
    // A view that closes the thread as its failure shows.
    const dispose = createRoot((dispose) => {
      const thread = createLocalChannelThread(
        { host, runtime: runtime(), fetchPage },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      );
      createEffect(() => {
        if (thread.error() === undefined) return;
        dispose();
        closed.resolve();
      });
      return dispose;
    });
    try {
      await asked.promise;
      // The connection is back before the request fails.
      onlineManager.setOnline(true);
      pending.reject(new TypeError('Failed to fetch'));
      await closed.promise;

      // A retry reads the device before it asks the server.
      expect(host.reads).toHaveLength(1);
      expect(fetchPage).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
      onlineManager.setOnline(true);
    }
  });

  it('aborts the load in flight when the thread closes', async () => {
    const host = fakeHost([devicePage([], { covered: false })]);
    const signals: AbortSignal[] = [];
    const fetchPage = vi.fn<FetchChannelThreadPage>(
      (_input, { signal }) =>
        new Promise(() => {
          if (signal) signals.push(signal);
        })
    );
    let dispose = () => {};
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return createLocalChannelThread(
        { host, runtime: runtime(), fetchPage },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      );
    });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    dispose();
    expect(signals[0]?.aborted).toBe(true);
  });

  it('aborts a reload started after an await when the thread closes', async () => {
    const host = fakeHost(() => devicePage([], { covered: false }));
    const signals: AbortSignal[] = [];
    const fetchPage = vi.fn<FetchChannelThreadPage>(
      async (_input, { signal }) => {
        if (signal) signals.push(signal);
        if (signals.length > 1) return new Promise(() => {});
        // The first read lands as the cache session changes: read again.
        return {
          page: {
            root,
            replies: [first, second],
            olderCursor: null,
            newerCursor: null,
            seq: '12',
          },
          cached: Promise.reject(new StaleCacheAuthorityError()),
        };
      }
    );
    let dispose = () => {};
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return createLocalChannelThread(
        { host, runtime: runtime(), fetchPage },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      );
    });
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    dispose();
    expect(signals[1]?.aborted).toBe(true);
  });

  it('reads a thread longer than one key read from the device', async () => {
    const replies = Array.from({ length: 620 }, (_, index) =>
      graphqlMessage(index + 10, { threadId: ROOT_ID })
    );
    const newestFirst = replies.map((reply) => channelMessageKey(reply.id));
    newestFirst.reverse();
    const pages = [];
    for (let at = 0; at < newestFirst.length; at += 100) {
      const keys = newestFirst.slice(at, at + 100);
      pages.push(
        devicePage(keys, {
          olderCursor: at + 100 < newestFirst.length ? `cursor-${at}` : null,
        })
      );
    }
    const host = fakeHost(pages, { records: [root, ...replies] });
    const read = vi.spyOn(host, 'readRecordsByKeys');

    const loaded = await loadChannelThread(host, CHANNEL_ID, ROOT_ID);

    if (loaded === 'unsupported') throw new Error('unexpected');
    expect(loaded.thread.replies).toHaveLength(620);
    for (const [args] of read.mock.calls) {
      expect(args.keys.length).toBeLessThanOrEqual(500);
    }
  });

  it('loads nothing until enabled', async () => {
    const host = fakeHost(() => devicePage([]), { records: [root] });

    const thread = createRoot(() =>
      createLocalChannelThread(
        { host, runtime: runtime(), fetchPage: serverThread() },
        CHANNEL_ID,
        () => ROOT_ID,
        () => false,
        () => undefined
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(host.reads).toHaveLength(0);
    expect(thread.isPending()).toBe(true);
  });

  it('hands over to REST when the host cannot serve channels', async () => {
    const host = fakeHost(() => ({ kind: 'unsupported' }));
    const onUnsupported = vi.fn();

    createRoot(() =>
      createLocalChannelThread(
        { host, runtime: runtime(), fetchPage: serverThread() },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        onUnsupported
      )
    );

    await vi.waitFor(() => expect(onUnsupported).toHaveBeenCalledTimes(1));
    // Its writes go over REST too.
    expect(markChannelCacheUnsupported).toHaveBeenCalledWith(host);
  });
});

describe('createLocalChannelThread after the cache was away', () => {
  it('loads a thread the cache could not store again, keeping it shown', async () => {
    let away = true;
    const host = fakeHost(() => {
      if (away) throw new Error('cache is away');
      return devicePage([], { covered: false });
    });
    const sync = runtime();
    const fetchPage = vi.fn<FetchChannelThreadPage>(async () => ({
      page: {
        root,
        replies: away ? [first] : [first, second],
        olderCursor: null,
        newerCursor: null,
        seq: '12',
      },
      cached: away
        ? Promise.reject(new Error('cache is away'))
        : Promise.resolve(applied('12')),
    }));
    const thread = createRoot(() =>
      createLocalChannelThread(
        { host, runtime: sync, fetchPage },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      )
    );
    await vi.waitFor(() =>
      expect(thread.replies()?.map((reply) => reply.id)).toEqual([first.id])
    );
    away = false;
    sync.resume();
    expect(thread.replies()).toHaveLength(1);
    await vi.waitFor(() =>
      expect(thread.replies()?.map((reply) => reply.id)).toEqual([
        first.id,
        second.id,
      ])
    );
  });
});

describe('createLocalChannelThread unstored replies', () => {
  it('shows a reply this page sent until the device holds it', async () => {
    const sent = graphqlMessage(5, { threadId: ROOT_ID });
    let keys = [channelMessageKey(second.id), channelMessageKey(first.id)];
    const host = fakeHost(() => devicePage(keys), {
      records: [root, first, second, sent],
    });
    const sync = runtime();
    const [unstored, setUnstored] = createSignal<Message[]>([
      mapChannelMessage(sent),
    ]);

    const thread = createRoot(() =>
      createLocalChannelThread(
        {
          host,
          runtime: sync,
          fetchPage: serverThread(),
          unstored: () => unstored(),
        },
        CHANNEL_ID,
        () => ROOT_ID,
        () => true,
        () => undefined
      )
    );
    await vi.waitFor(() =>
      expect(thread.replies()?.map((reply) => reply.id)).toEqual([
        first.id,
        second.id,
        sent.id,
      ])
    );

    // The device stores it: shown once, from the device.
    keys = [channelMessageKey(sent.id), ...keys];
    sync.change();
    await vi.waitFor(() => expect(host.reads.length).toBeGreaterThan(1));
    setUnstored([]);
    await vi.waitFor(() =>
      expect(thread.replies()?.map((reply) => reply.id)).toEqual([
        first.id,
        second.id,
        sent.id,
      ])
    );
  });
});
