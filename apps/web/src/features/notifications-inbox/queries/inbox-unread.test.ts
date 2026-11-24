import {
  NotificationInboxUnreadUpdatesDocument,
  NotificationInboxUnreadUpdatesWithoutChatDocument,
} from '@service-storage/graphql/generated/graphql';
import { type Client, CombinedError } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeSubject } from 'wonka';
import { createInboxUnread } from './inbox-unread';

function setup() {
  const streams: ReturnType<typeof makeSubject<unknown>>[] = [];
  const documents: unknown[] = [];
  const client = {
    subscription: (document: unknown) => {
      const stream = makeSubject<unknown>();
      streams.push(stream);
      documents.push(document);
      return stream.source;
    },
  } as unknown as Client;
  const reconnectListeners = new Set<() => void>();
  const [enabled, setEnabled] = createSignal(true);
  const dispose = { run: () => {} };
  const counts = createRoot((disposer) => {
    dispose.run = disposer;
    return createInboxUnread({
      client: () => client,
      enabled,
      onReconnected: (listener) => {
        reconnectListeners.add(listener);
        return () => reconnectListeners.delete(listener);
      },
    });
  });
  const send = (index: number, payload: unknown[]) =>
    streams[index].next({ data: { notificationInboxUnreadUpdates: payload } });
  return {
    counts,
    streams,
    documents,
    send,
    reconnectListeners,
    setEnabled,
    dispose,
  };
}

const refusal = (message: string) => ({
  error: new CombinedError({ graphQLErrors: [{ message }] }),
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createInboxUnread', () => {
  it('holds the latest payload, whole', () => {
    const { counts, send, dispose } = setup();
    expect(counts()).toBeUndefined();

    send(0, [
      { rowType: 'EMAIL', count: 4 },
      { rowType: 'CHANNEL_THREAD', count: 2 },
    ]);
    expect(counts()).toEqual([
      { type: 'email', passwordRequests: false, count: 4 },
      { type: 'channel_thread', passwordRequests: false, count: 2 },
    ]);

    // A later payload replaces the last: mail was read.
    send(0, [{ rowType: 'CHANNEL_THREAD', count: 2 }]);
    expect(counts()).toEqual([
      { type: 'channel_thread', passwordRequests: false, count: 2 },
    ]);

    send(0, []);
    expect(counts()).toEqual([]);
    dispose.run();
  });

  it('tells vault access requests apart and keeps kinds it does not know', () => {
    const { counts, send, dispose } = setup();

    send(0, [
      { rowType: 'ACCESS_REQUESTED', count: 1 },
      { rowType: 'PASSWORD_ACCESS_REQUESTED', count: 2 },
      { rowType: 'A_KIND_FROM_LATER', count: 3 },
    ]);

    expect(counts()).toEqual([
      { type: 'access_requested', passwordRequests: false, count: 1 },
      { type: 'access_requested', passwordRequests: true, count: 2 },
      { type: 'other', passwordRequests: false, count: 3 },
    ]);
    dispose.run();
  });

  it('opens the stream again after it errors, keeping the last counts meanwhile', () => {
    vi.useFakeTimers();
    const { counts, streams, send, dispose } = setup();
    send(0, [{ rowType: 'EMAIL', count: 4 }]);

    streams[0].next({
      error: new CombinedError({ networkError: new Error('ended') }),
    });
    expect(streams).toHaveLength(1);
    expect(counts()).toEqual([
      { type: 'email', passwordRequests: false, count: 4 },
    ]);

    vi.advanceTimersByTime(3_000);
    expect(streams).toHaveLength(2);
    send(1, [{ rowType: 'EMAIL', count: 5 }]);
    expect(counts()).toEqual([
      { type: 'email', passwordRequests: false, count: 5 },
    ]);
    // The stream that errored is no longer heard.
    send(0, [{ rowType: 'EMAIL', count: 9 }]);
    expect(counts()).toEqual([
      { type: 'email', passwordRequests: false, count: 5 },
    ]);
    dispose.run();
  });

  it('opens the stream again when the transport reconnects', () => {
    const { counts, streams, send, reconnectListeners, dispose } = setup();
    send(0, [{ rowType: 'EMAIL', count: 4 }]);

    for (const listener of reconnectListeners) listener();
    expect(streams).toHaveLength(2);
    send(0, [{ rowType: 'EMAIL', count: 9 }]);
    expect(counts()).toEqual([
      { type: 'email', passwordRequests: false, count: 4 },
    ]);
    send(1, []);
    expect(counts()).toEqual([]);
    dispose.run();
  });

  it('holds how many rows of each kind Chat shows', () => {
    const { counts, send, dispose } = setup();
    send(0, [{ rowType: 'CHANNEL_THREAD', count: 2, chatCount: 1 }]);
    expect(counts()).toEqual([
      {
        type: 'channel_thread',
        passwordRequests: false,
        count: 2,
        chatCount: 1,
      },
    ]);
    dispose.run();
  });

  it.each([
    'Unknown field "chatCount" on type "NotificationInboxUnreadCount".',
    'Unknown field "chatCount" on type "NotificationInboxUnreadCount". Did you mean "count"?',
    'Cannot query field "chatCount" on type "NotificationInboxUnreadCount".',
  ])('keeps counting against a server from before chatCount: %s', (message) => {
    vi.useFakeTimers();
    const { counts, streams, documents, send, reconnectListeners, dispose } =
      setup();
    expect(documents).toEqual([NotificationInboxUnreadUpdatesDocument]);

    // Asked again at once, not after the delay, so no dot goes dark.
    streams[0].next(refusal(message));
    expect(documents).toEqual([
      NotificationInboxUnreadUpdatesDocument,
      NotificationInboxUnreadUpdatesWithoutChatDocument,
    ]);
    send(1, [{ rowType: 'CHANNEL_THREAD', count: 2 }]);
    expect(counts()).toEqual([
      { type: 'channel_thread', passwordRequests: false, count: 2 },
    ]);

    // The new server is asked for everything again once it takes over.
    for (const listener of reconnectListeners) listener();
    expect(documents[2]).toBe(NotificationInboxUnreadUpdatesDocument);
    send(2, [{ rowType: 'CHANNEL_THREAD', count: 2, chatCount: 0 }]);
    expect(counts()).toEqual([
      {
        type: 'channel_thread',
        passwordRequests: false,
        count: 2,
        chatCount: 0,
      },
    ]);
    dispose.run();
  });

  it('waits before asking again when a stream without chatCount ends', () => {
    vi.useFakeTimers();
    const { streams, documents, dispose } = setup();
    const refused = refusal(
      'Unknown field "chatCount" on type "NotificationInboxUnreadCount".'
    );
    streams[0].next(refused);
    streams[1].next(refused);
    expect(streams).toHaveLength(2);

    vi.advanceTimersByTime(3_000);
    expect(documents[2]).toBe(NotificationInboxUnreadUpdatesDocument);
    dispose.run();
  });

  it('stops and forgets its counts when disabled, and when disposed', () => {
    vi.useFakeTimers();
    const { counts, streams, send, reconnectListeners, setEnabled, dispose } =
      setup();
    send(0, [{ rowType: 'EMAIL', count: 4 }]);

    setEnabled(false);
    expect(counts()).toBeUndefined();
    expect(reconnectListeners.size).toBe(0);
    send(0, [{ rowType: 'EMAIL', count: 9 }]);
    expect(counts()).toBeUndefined();

    setEnabled(true);
    expect(streams).toHaveLength(2);
    streams[1].next({
      error: new CombinedError({ networkError: new Error('ended') }),
    });
    dispose.run();
    vi.advanceTimersByTime(3_000);
    expect(streams).toHaveLength(2);
  });

  it('starts a reader that joins an open stream from its latest counts', () => {
    // urql shares one stream among a client's readers and replays nothing
    // to a reader that joins it later.
    const stream = makeSubject<unknown>();
    const client = { subscription: () => stream.source } as unknown as Client;
    const read = () =>
      createRoot((dispose) => ({
        dispose,
        counts: createInboxUnread({
          client: () => client,
          enabled: () => true,
          onReconnected: () => () => {},
        }),
      }));
    const first = read();
    stream.next({
      data: {
        notificationInboxUnreadUpdates: [{ rowType: 'EMAIL', count: 2 }],
      },
    });

    const second = read();
    expect(second.counts()).toEqual([
      { type: 'email', passwordRequests: false, count: 2 },
    ]);
    first.dispose();
    second.dispose();
  });
});
