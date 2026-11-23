import {
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
} from '@graphql-cache/index';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { channelMessageKey } from '../channel-map';
import {
  createLocalChannelThread,
  type FetchChannelThreadPage,
  loadChannelThread,
} from '../channel-thread';
import { CHANNEL_ID, devicePage, fakeHost, graphqlMessage } from './fixtures';

vi.mock('@macro-inc/observability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@macro-inc/observability')>()),
  Telemetry: {
    error: vi.fn(),
    span: async (_name: string, run: (span: unknown) => unknown) =>
      run({ setAttr: () => undefined }),
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
