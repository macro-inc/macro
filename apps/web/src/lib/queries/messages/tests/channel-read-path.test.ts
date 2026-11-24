import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { CHANNEL_ID, fakeHost, graphqlMessage } from '../local/tests/fixtures';

type FlagAnswer = { enabled: boolean; loading: boolean };

const mocks = vi.hoisted(() => ({
  host: {} as unknown,
  fetchResolved: vi.fn(),
}));

vi.mock('@app/lib/analytics/posthog', async () => {
  const solid = await import('solid-js');
  const [read, write] = solid.createSignal<FlagAnswer>({
    enabled: false,
    loading: true,
  });
  return { useFeatureFlag: () => read, __setFlag: write };
});
vi.mock('@service-storage/graphql-soup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@service-storage/graphql-soup')>()),
  getGraphqlSoupCacheHost: () => mocks.host,
  graphqlCacheEnabled: () => true,
}));
vi.mock('../local/channel-flag', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../local/channel-flag')>()),
  channelCacheSupported: () => true,
}));

vi.mock('../timeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../timeline')>()),
  fetchResolvedChannelMessage: mocks.fetchResolved,
}));

const { useChannelReadPath, useChannelMessageResolver } = await import(
  '../channel-timeline-source'
);
const posthog = (await import('@app/lib/analytics/posthog')) as unknown as {
  __setFlag: (next: FlagAnswer) => void;
};

describe('useChannelReadPath', () => {
  it('reads over REST at once while the flag has no answer, and stays there', () => {
    posthog.__setFlag({ enabled: false, loading: true });
    const [parent] = createSignal({ type: 'channel' as const, id: 'c1' });

    const path = createRoot(() => useChannelReadPath(parent));
    expect(path.mode()).toBe('rest');

    posthog.__setFlag({ enabled: true, loading: false });
    expect(path.mode()).toBe('rest');
  });

  it('reads from the device when the flag is on at mount, and stays there', () => {
    posthog.__setFlag({ enabled: true, loading: false });
    const [parent] = createSignal({ type: 'channel' as const, id: 'c1' });

    const path = createRoot(() => useChannelReadPath(parent));
    expect(path.mode()).toBe('local');

    posthog.__setFlag({ enabled: false, loading: false });
    expect(path.mode()).toBe('local');

    path.setUnsupported();
    expect(path.mode()).toBe('rest');
  });
});

describe('useChannelMessageResolver', () => {
  it('places a linked reply from the device, without the server', async () => {
    posthog.__setFlag({ enabled: true, loading: false });
    const root = graphqlMessage(1);
    const reply = graphqlMessage(2, { threadId: root.id });
    mocks.host = fakeHost([], { records: [root, reply] });
    const [parent] = createSignal({ type: 'channel' as const, id: CHANNEL_ID });

    // With no connection the server is not there to ask.
    const resolve = createRoot(() => useChannelMessageResolver(parent));
    expect(await resolve(reply.id)).toEqual({
      kind: 'thread_reply',
      threadId: root.id,
    });
    expect(await resolve(root.id)).toEqual({ kind: 'top_level' });
    expect(mocks.fetchResolved).not.toHaveBeenCalled();
    mocks.host = {};
  });

  it('asks the server for a message the device does not hold', async () => {
    posthog.__setFlag({ enabled: true, loading: false });
    mocks.host = fakeHost([]);
    mocks.fetchResolved.mockResolvedValueOnce({
      kind: 'thread_reply',
      thread_id: 'root-9',
    });
    const [parent] = createSignal({ type: 'channel' as const, id: CHANNEL_ID });

    const resolve = createRoot(() => useChannelMessageResolver(parent));
    expect(await resolve('reply-9')).toEqual({
      kind: 'thread_reply',
      threadId: 'root-9',
    });
    expect(mocks.fetchResolved).toHaveBeenCalledWith(parent(), 'reply-9');
    mocks.host = {};
  });
});
