import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import {
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
} from '@graphql-cache/index';
import type { Message } from '@service-storage/messages';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { channelMessageKey, mapChannelMessage } from '../channel-map';
import { noteChannelReset, whileNoFills } from '../channel-resets';
import {
  createLocalChannelThread,
  type FetchChannelThreadPage,
  loadChannelThread,
} from '../channel-thread';
import { fakeLocks } from './fake-locks';
import { CHANNEL_ID, devicePage, fakeHost, graphqlMessage } from './fixtures';

vi.mock('@macro-inc/observability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@macro-inc/observability')>()),
  Telemetry: {
    error: vi.fn(),
    span: async (_name: string, run: (span: unknown) => unknown) =>
      run({ setAttr: () => undefined, run: <T>(op: () => T) => op() }),
  },
}));

vi.mock('@graphql-cache/session-generation', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@graphql-cache/session-generation')>();
  return {
    ...actual,
    cacheSessionGeneration: Object.assign(
      Object.create(actual.cacheSessionGeneration),
      { capture: () => 'generation-1' }
    ),
  };
});

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
    cached: Promise.resolve(),
  }));
}

function runtime() {
  const listeners = new Set<() => void>();
  return {
    open: vi.fn(() => () => undefined),
    onChanged: vi.fn((_channelId: string, listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    noteStoredSeq: vi.fn(),
    noteServerRead: vi.fn(),
    ensureCurrent: vi.fn(async () => 'current' as const),
    epoch: () => 0,
    change: () => {
      for (const listener of listeners) listener();
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

    expect(loaded).toMatchObject({ source: 'device', seq: '7' });
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

    const loaded = await loadChannelThread(host, CHANNEL_ID, ROOT_ID, {
      fetchPage: serverThread(),
    });

    expect(loaded).toMatchObject({ source: 'server', seq: '12' });
    expect(host.commits).toEqual([
      {
        channelId: CHANNEL_ID,
        coverage: [
          {
            threadRootId: ROOT_ID,
            start: CHANNEL_TIMELINE_START,
            end: CHANNEL_TIMELINE_HEAD,
          },
        ],
        seq: { kind: 'lower', seq: '12' },
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
      seq: null,
      sessionChanged: true,
    });
    expect(host.commits).toEqual([]);
  });

  it('commits no coverage when the channel was reset while the thread was fetched', async () => {
    const host = fakeHost([devicePage([], { covered: false })]);
    const fetchPage = vi.fn<FetchChannelThreadPage>(async () => {
      noteChannelReset(host, CHANNEL_ID);
      return {
        page: {
          root,
          replies: [first, second],
          olderCursor: null,
          newerCursor: null,
          seq: '12',
        },
        cached: Promise.resolve(),
      };
    });

    const loaded = await loadChannelThread(host, CHANNEL_ID, ROOT_ID, {
      fetchPage,
    });

    expect(loaded).toMatchObject({ source: 'server', seq: null });
    expect(host.commits).toEqual([]);
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
    expect(host.commits).toEqual([]);
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
        cached: Promise.resolve(),
      };
    });

    await expect(
      loadChannelThread(host, CHANNEL_ID, ROOT_ID, {
        fetchPage,
        signal: abort.signal,
      })
    ).rejects.toThrow();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(host.commits).toEqual([]);
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
    expect(sync.noteStoredSeq).toHaveBeenCalledWith(CHANNEL_ID, '7');
    expect(sync.ensureCurrent).toHaveBeenCalledWith(CHANNEL_ID);

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
    await vi.waitFor(() => expect(host.commits).toHaveLength(1));
    expect(thread.replies()).toHaveLength(2);
  });

  describe('with a delete in another tab', () => {
    const deleting = () => {
      let finish!: () => void;
      const done = whileNoFills(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
        { waitMs: 60_000 }
      );
      return { finish: () => finish(), done };
    };
    const open = () => {
      const host = fakeHost(() => devicePage([], { covered: false }));
      const fetchPage = serverThread();
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
      return { host, fetchPage, thread, dispose: () => dispose() };
    };

    it('reads the thread again once the delete is done, holding it then', async () => {
      vi.stubGlobal('navigator', { locks: fakeLocks() });
      try {
        const deletion = deleting();
        const { host, fetchPage, thread, dispose } = open();
        await vi.waitFor(() => expect(thread.replies()).toHaveLength(2));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(fetchPage).toHaveBeenCalledTimes(1);
        expect(host.commits).toEqual([]);

        deletion.finish();
        await deletion.done;
        await vi.waitFor(() => expect(host.commits).toHaveLength(1));
        expect(fetchPage).toHaveBeenCalledTimes(2);
        dispose();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('reads nothing more once the thread closes while it waits', async () => {
      vi.stubGlobal('navigator', { locks: fakeLocks() });
      try {
        const deletion = deleting();
        const { host, fetchPage, thread, dispose } = open();
        await vi.waitFor(() => expect(thread.replies()).toHaveLength(2));
        dispose();

        deletion.finish();
        await deletion.done;
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(fetchPage).toHaveBeenCalledTimes(1);
        expect(host.commits).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it('aborts the load in flight when the thread closes', async () => {
    const host = fakeHost([devicePage([], { covered: false })]);
    const signals: AbortSignal[] = [];
    const fetchPage = vi.fn<FetchChannelThreadPage>(
      (_input, signal) =>
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
    const fetchPage = vi.fn<FetchChannelThreadPage>(async (_input, signal) => {
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
    });
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
