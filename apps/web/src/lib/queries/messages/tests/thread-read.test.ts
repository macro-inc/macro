import type { MessageParent } from '@service-storage/messages';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mode: 'local' as 'local' | 'rest',
  thread: undefined as object | undefined,
  retry: vi.fn(async () => {}),
  rest: {} as Record<string, unknown>,
  restOptions: undefined as { enabled: boolean } | undefined,
}));
vi.mock('../channel-timeline-source', () => ({
  useChannelReadPath: () => ({
    host: () => ({}),
    mode: () => mocks.mode,
    setUnsupported: () => {},
  }),
}));
vi.mock('../local/channel-sync', () => ({
  channelSyncRuntime: () => ({}),
  channelWrites: () => ({ unstoredReplies: () => [] }),
}));
vi.mock('../local/channel-thread', () => ({
  createLocalChannelThread: () => mocks.thread,
}));
vi.mock('../subscription', () => ({ useMessageSubscription: () => {} }));
vi.mock('@service-storage/messages', () => ({ entityMessagesClient: {} }));
vi.mock('@tanstack/solid-query', () => ({
  useQuery: (options: () => { enabled: boolean }) => {
    mocks.restOptions = options();
    return mocks.rest;
  },
}));
vi.mock('../../client', () => ({
  queryClient: { getQueryState: () => undefined, getQueriesData: () => [] },
}));

const { useMessageThreadQuery } = await import('../thread-replies');

const parent: MessageParent = { type: 'channel', id: 'channel-1' };
const whole = { root: { id: 'root' }, replies: [] };

function read() {
  return createRoot(() =>
    useMessageThreadQuery(
      () => parent,
      () => 'root'
    )
  );
}

beforeEach(() => {
  mocks.mode = 'local';
  mocks.rest = {
    data: 'rest',
    isPending: false,
    isSuccess: true,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(async () => 'rest'),
  };
  mocks.retry.mockClear();
});

it('reads a whole thread from the device, without asking over REST', async () => {
  const [thread, setThread] = createSignal<object | undefined>();
  const [error, setError] = createSignal<unknown>();
  mocks.thread = {
    thread,
    error,
    replies: () => [],
    isPending: () => thread() === undefined && error() === undefined,
    retry: mocks.retry,
  };
  const query = read();
  expect(mocks.restOptions?.enabled).toBe(false);
  expect(query).toMatchObject({ isPending: true, isSuccess: false });

  setError(new Error('offline'));
  expect(query).toMatchObject({ isPending: false, isError: true });
  await query.refetch();
  expect(mocks.retry).toHaveBeenCalledTimes(1);

  // What it shows stays through a later failure.
  setThread(whole);
  expect(query).toMatchObject({ isSuccess: true, isError: false, data: whole });
});

it('reads a thread over REST where the channel does', async () => {
  mocks.mode = 'rest';
  const query = read();
  expect(mocks.restOptions?.enabled).toBe(true);
  expect(query).toMatchObject({ data: 'rest', isSuccess: true });
  expect(await query.refetch()).toBe('rest');
});
