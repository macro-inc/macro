import type { OperationResult } from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_STREAM_RETRY_MS, createChannelStream } from '../channel-stream';
import { CHANNEL_ID } from './fixtures';

vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: vi.fn() },
}));

type Listener = (result: OperationResult) => void;

function fakeClient() {
  const subscriptions: { listener: Listener; closed: boolean }[] = [];
  const client = {
    subscription: vi.fn(() => ({
      subscribe(listener: Listener) {
        const entry = { listener, closed: false };
        subscriptions.push(entry);
        return {
          unsubscribe: () => {
            entry.closed = true;
          },
        };
      },
    })),
  };
  const live = () => subscriptions.filter((entry) => !entry.closed);
  const emit = (result: Partial<OperationResult>) => {
    for (const entry of live()) entry.listener(result as OperationResult);
  };
  return { client, live, emit };
}

function fakeRuntime() {
  return {
    onFrame: vi.fn(),
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
  };
}

const update = {
  channelId: CHANNEL_ID,
  seq: '8',
  messages: [],
  activities: [],
  removedIds: [],
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createChannelStream', () => {
  it('hands each frame to the runtime, stored only once the cache wrote it', () => {
    const { client, emit } = fakeClient();
    const runtime = fakeRuntime();
    createChannelStream(client as never, runtime);

    emit({
      data: { channelTimelineUpdates: update },
      hasNext: true,
      extensions: {},
    });

    expect(runtime.onFrame).toHaveBeenCalledWith(update, false);
  });

  it('reports the socket connecting and closing', () => {
    const { client } = fakeClient();
    const runtime = fakeRuntime();
    const stream = createChannelStream(client as never, runtime);

    stream.connected();
    expect(runtime.onConnected).toHaveBeenCalledTimes(1);
    stream.disconnected();
    expect(runtime.onDisconnected).toHaveBeenCalledTimes(1);
  });

  it('subscribes again after a stream that fell behind, and catches up on the open socket', () => {
    const { client, emit, live } = fakeClient();
    const runtime = fakeRuntime();
    const stream = createChannelStream(client as never, runtime);
    stream.connected();

    emit({
      error: new Error('fell behind; subscribe again and catch up') as never,
      hasNext: false,
    });
    expect(runtime.onDisconnected).toHaveBeenCalledTimes(1);
    expect(live()).toHaveLength(0);

    vi.advanceTimersByTime(CHANNEL_STREAM_RETRY_MS);
    expect(live()).toHaveLength(1);
    expect(runtime.onConnected).toHaveBeenCalledTimes(2);
  });

  it('waits longer after each stream that ends without a frame', () => {
    const { client, emit, live } = fakeClient();
    const stream = createChannelStream(client as never, fakeRuntime());
    stream.connected();

    emit({ hasNext: false });
    vi.advanceTimersByTime(CHANNEL_STREAM_RETRY_MS);
    emit({ hasNext: false });
    vi.advanceTimersByTime(CHANNEL_STREAM_RETRY_MS);
    expect(live()).toHaveLength(0);
    vi.advanceTimersByTime(CHANNEL_STREAM_RETRY_MS);
    expect(live()).toHaveLength(1);
  });

  it('stops for good when disposed', () => {
    const { client, emit, live } = fakeClient();
    const runtime = fakeRuntime();
    const stream = createChannelStream(client as never, runtime);
    emit({ hasNext: false });
    stream.dispose();
    vi.advanceTimersByTime(CHANNEL_STREAM_RETRY_MS * 10);
    expect(live()).toHaveLength(0);
    expect(client.subscription).toHaveBeenCalledTimes(1);
  });
});
