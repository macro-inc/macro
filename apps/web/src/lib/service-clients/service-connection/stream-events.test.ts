import {
  ArrayQueue,
  JsonSerializer,
  WebsocketBuilder,
} from '@macro-inc/collaboration/websocket';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ToWebsocketMessage } from './generated/schemas/toWebsocketMessage';
import type {
  ConnectionGatewayWebsocket,
  FromWebsocketMessage,
} from './websocket';

const mocks = vi.hoisted(() => ({
  ws: undefined as ConnectionGatewayWebsocket | undefined,
}));
vi.mock('./websocket', () => ({
  get ws() {
    if (!mocks.ws) throw new Error('Missing test gateway');
    return mocks.ws;
  },
  createConnectionWebsocketEffect: vi.fn(),
}));

class TestSocket extends EventTarget {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  extensions = '';
  protocol = '';
  url = 'ws://unused';
  readyState: number = this.CONNECTING;
  onclose = null;
  onerror = null;
  onmessage = null;
  onopen = null;
  send = vi.fn();

  open() {
    this.readyState = this.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  close() {
    this.readyState = this.CLOSED;
    this.dispatchEvent(new CloseEvent('close'));
  }
}

let nextSocket = Promise.withResolvers<TestSocket>();
const disposers: (() => void)[] = [];

beforeEach(() => {
  vi.resetModules();
  nextSocket = Promise.withResolvers<TestSocket>();
  mocks.ws = new WebsocketBuilder('ws://unused')
    .withAutoConnect(false)
    .withSerializer(
      new JsonSerializer<ToWebsocketMessage, FromWebsocketMessage>()
    )
    .withBuffer(new ArrayQueue())
    .withFactory(() => {
      const socket = new TestSocket();
      nextSocket.resolve(socket);
      return socket;
    })
    .build();
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  mocks.ws?.close();
});

it('sends pre-activation and connecting subscriptions once on open, then replays on reconnect', async () => {
  const { subscribeToStreamState } = await import('./stream-events');
  createRoot((dispose) => {
    disposers.push(dispose);
    subscribeToStreamState('before-activation', 'chat');
    subscribeToStreamState('not-streamable', 'document');
  });
  const disposeBeforeActivation = createRoot((dispose) => {
    subscribeToStreamState('already-unmounted', 'chat');
    return dispose;
  });
  disposeBeforeActivation();
  mocks.ws?.reconnect();
  const first = await nextSocket.promise;
  createRoot((dispose) => {
    disposers.push(dispose);
    subscribeToStreamState('while-connecting', 'chat');
    subscribeToStreamState('before-activation', 'chat');
  });
  expect(first.send).not.toHaveBeenCalled();
  first.open();
  expect(first.send.mock.calls).toEqual([
    [
      JSON.stringify({
        type: 'stream_events',
        entity_id: 'before-activation',
        entity_type: 'chat',
      }),
    ],
    [
      JSON.stringify({
        type: 'stream_events',
        entity_id: 'while-connecting',
        entity_type: 'chat',
      }),
    ],
  ]);

  nextSocket = Promise.withResolvers<TestSocket>();
  first.close();
  mocks.ws?.reconnect();
  const second = await nextSocket.promise;
  second.open();
  expect(second.send.mock.calls).toEqual(first.send.mock.calls);
});

it('keeps shared subscriptions while mounted and drops them from replay after the last consumer leaves', async () => {
  const { subscribeToStreamState } = await import('./stream-events');
  mocks.ws?.reconnect();
  const first = await nextSocket.promise;
  first.open();
  const disposeFirst = createRoot((dispose) => {
    disposers.push(dispose);
    subscribeToStreamState('shared-chat', 'chat');
    return dispose;
  });
  const disposeSecond = createRoot((dispose) => {
    disposers.push(dispose);
    subscribeToStreamState('shared-chat', 'chat');
    return dispose;
  });
  expect(first.send).toHaveBeenCalledOnce();
  disposeFirst();

  nextSocket = Promise.withResolvers<TestSocket>();
  first.close();
  mocks.ws?.reconnect();
  const second = await nextSocket.promise;
  second.open();
  expect(second.send.mock.calls).toEqual(first.send.mock.calls);
  disposeSecond();
  const disposeRemount = createRoot((dispose) => {
    disposers.push(dispose);
    subscribeToStreamState('shared-chat', 'chat');
    return dispose;
  });
  // The server has no unsubscribe frame: remounting must not create a second
  // subscription on the same connection, even after every consumer unmounted.
  expect(second.send).toHaveBeenCalledOnce();
  disposeRemount();

  nextSocket = Promise.withResolvers<TestSocket>();
  second.close();
  mocks.ws?.reconnect();
  const third = await nextSocket.promise;
  third.open();
  expect(third.send).not.toHaveBeenCalled();
});
